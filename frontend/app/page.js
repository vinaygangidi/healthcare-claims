'use client';

import { useState, useEffect, useRef } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8002';

// Per-scenario story: real-world problem, which agents carry the load, financial stakes
const SCENARIO_STORIES = {
  '01': {
    headline: 'Baseline: A textbook clean claim with no surprises.',
    problem: 'A primary care practice submits a routine office visit for an established patient with active Blue Cross coverage. All CPT codes are valid, prior auth is not required, and the fee schedule match is exact. This is the best-case path that revenue cycle teams want every claim to follow.',
    agentFocus: ['ClaimParserAgent', 'EligibilityAgent', 'AdjudicationAgent'],
    focusNote: 'Claim Intake extracts the structured 837P fields using Document Intelligence. Coverage Verification confirms active membership. Adjudication applies the fee schedule and produces a clean ERA.',
    stakes: 'In a 500-bed hospital system, roughly 65% of claims should follow this path. Any deviation raises cost per claim from $0.10 to $2-3 in manual rework.',
  },
  '02': {
    headline: 'High denial risk: missing prior auth, lapsed coverage, excluded service.',
    problem: 'A hospital submits claims for 5 patients. One patient coverage lapsed 12 days before the date of service. Another service requires prior auth that was never obtained. A third claim includes a procedure explicitly excluded from the plan. These are the top three denial drivers in US healthcare, accounting for over $260 billion in rejected claims annually.',
    agentFocus: ['EligibilityAgent', 'DenialReasoningAgent'],
    focusNote: 'Coverage Verification catches the lapsed eligibility and missing auth. Denial Prevention then classifies each denial as correctable vs. hard, and generates the specific resubmission strategy for each one.',
    stakes: 'Each uncaught denial costs a provider $118 in administrative rework on average. Catching these before posting saves days-in-AR and prevents write-offs.',
  },
  '03': {
    headline: 'COB Complexity: patient has two insurance plans that must coordinate.',
    problem: 'A patient is covered by both an employer plan (primary) and a spouse plan (secondary). The primary payer processes first and pays its share. The secondary payer receives the Explanation of Benefits and calculates its responsibility for the remaining balance. This coordination handoff is one of the most error-prone workflows in manual RCM.',
    agentFocus: ['EligibilityAgent', 'RemittancePostingAgent'],
    focusNote: 'Coverage Verification detects the dual-coverage flag and identifies primary vs. secondary. Payment Posting generates separate ERA entries for each payer and correctly computes the patient balance after both plans pay.',
    stakes: 'COB errors result in either overpayment (costly to recover) or patient overbilling (compliance risk). Automated coordination eliminates both.',
  },
  '04': {
    headline: 'Coding Compliance: NCCI bundling violations and missing modifiers.',
    problem: 'A surgical center submits a claim with two CPT codes that Medicare National Correct Coding Initiative rules say must be billed as a single bundled code. The claim also lacks the -59 modifier that would justify billing them separately. Without AI review, this sails through intake and gets denied weeks later by the payer.',
    agentFocus: ['ClaimParserAgent', 'AdjudicationAgent'],
    focusNote: 'Claim Intake flags the missing modifier during Document Intelligence extraction. Adjudication then applies NCCI bundling rules and recalculates the allowed amount as a single bundled procedure code.',
    stakes: 'Medicare NCCI denials are non-correctable if the modifier was missing at submission. Catching this before submission avoids a hard denial and potential compliance audit.',
  },
  '05': {
    headline: 'Underpayment Detection: payer paid less than the contracted rate.',
    problem: 'A specialist billed $1,200 for a procedure with a contracted allowed amount of $890. The payer remitted only $620, citing an incorrect fee schedule version. Without automated variance detection, this underpayment gets posted to the GL and written off as a contractual adjustment, silently eroding revenue.',
    agentFocus: ['AdjudicationAgent', 'RevenueAuditAgent'],
    focusNote: 'Adjudication applies the correct contracted fee schedule and flags the variance between what the payer paid and what the contract entitles. Revenue Integrity then surfaces this as an underpayment trend in the KPI summary for leadership action.',
    stakes: 'Industry estimates put systematic underpayment at 3-5% of net revenue. For a $500M health system, that is $15-25M in recoverable revenue left on the table annually.',
  },
};

// What each agent does technically and which Azure model and why
const AGENT_TECH = {
  ClaimParserAgent: {
    role: 'Document Intelligence',
    model: 'GPT-4o-mini',
    why: 'Structured field extraction from CMS-1500 / 837P EDI format. Fast and low-cost because the task is deterministic parsing, not reasoning.',
    diNote: 'This is the Document Intelligence layer: extracting CPT codes, ICD-10 diagnoses, NPI numbers, charge amounts, and dates from unstructured claim documents -- the same job Azure Document Intelligence does for invoices and forms.',
  },
  EligibilityAgent: {
    role: 'Policy Reasoning',
    model: 'GPT-4o-mini',
    why: 'Rule-based eligibility lookup against payer plan data. Structured input/output, no complex reasoning required.',
    diNote: 'Reads the parsed claim fields and applies payer coverage rules, prior auth tables, and cost-sharing formulas. Analogous to calling an 837 clearinghouse eligibility API with AI-powered rule interpretation.',
  },
  AdjudicationAgent: {
    role: 'Complex Reasoning',
    model: 'GPT-4o',
    why: 'Fee schedule math, NCCI bundling logic, and multi-line adjudication require the full reasoning capability of GPT-4o. Errors here have direct financial impact.',
    diNote: 'The most computationally expensive step. GPT-4o applies contracted fee schedules, detects unbundling and upcoding, and produces line-level financial outcomes. This is where the AI earns its cost.',
  },
  DenialReasoningAgent: {
    role: 'Classification and Strategy',
    model: 'GPT-4o',
    why: 'Denial classification requires understanding payer-specific denial codes, appeal rights timelines, and correctable vs. hard denial logic. Needs GPT-4o depth.',
    diNote: 'Reads adjudication output and produces denial reason codes, correctable/hard classification, and resubmission strategies. The output directly drives appeal workflows.',
  },
  RemittancePostingAgent: {
    role: 'Ledger Generation',
    model: 'GPT-4o-mini',
    why: 'ERA entry generation is deterministic given the adjudication output. GPT-4o-mini is accurate and 10x cheaper for this structured transformation.',
    diNote: 'Produces 835 ERA entries and GL debit/credit records. The output feeds directly into EHR or billing system posting queues.',
  },
  RevenueAuditAgent: {
    role: 'KPI Analytics',
    model: 'GPT-4o-mini',
    why: 'KPI calculation from structured data is a summarization task. GPT-4o-mini handles it accurately at low cost.',
    diNote: 'Reads all prior agent outputs and produces clean claim rate, denial rate, days-in-AR estimate, and underpayment flags. This is the dashboard data that revenue cycle leadership acts on.',
  },
};

const AGENT_ORDER = [
  'ClaimParserAgent',
  'EligibilityAgent',
  'AdjudicationAgent',
  'DenialReasoningAgent',
  'RemittancePostingAgent',
  'RevenueAuditAgent',
];

// Business-friendly labels for the pipeline cards
const AGENT_BIZ_LABELS = {
  ClaimParserAgent:      'Claim Intake',
  EligibilityAgent:      'Coverage Verification',
  AdjudicationAgent:     'Adjudication',
  DenialReasoningAgent:  'Denial Prevention',
  RemittancePostingAgent:'Payment Posting',
  RevenueAuditAgent:     'Revenue Integrity',
};

const AGENT_ICONS = {
  ClaimParserAgent:      '📋',
  EligibilityAgent:      '🔍',
  AdjudicationAgent:     '⚖️',
  DenialReasoningAgent:  '🚫',
  RemittancePostingAgent:'💳',
  RevenueAuditAgent:     '📊',
};

// Presentation-ready scenario name overrides
const SCENARIO_LABELS = {
  '01': 'Clean Claim',
  '02': 'High Denial Risk',
  '03': 'COB Complexity',
  '04': 'Coding Compliance Risk',
  '05': 'Underpayment Detection',
};

function fmt(sec) {
  if (sec === null || sec === undefined) return '';
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function fmtTimer(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function Home() {
  const [samples, setSamples] = useState([]);
  const [selectedSample, setSelectedSample] = useState('01');
  const [loading, setLoading] = useState(false);
  const [agentStates, setAgentStates] = useState({});
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [runMs, setRunMs] = useState(null);
  const [agentStartTimes, setAgentStartTimes] = useState({});
  const [agentElapsed, setAgentElapsed] = useState({});
  const [activeAgent, setActiveAgent] = useState(null);
  const [liveTokens, setLiveTokens] = useState('');
  const [handoffs, setHandoffs] = useState([]);
  const [showTechStack, setShowTechStack] = useState(false);
  const runStartRef = useRef(null);
  const timerRef = useRef(null);
  const [timerMs, setTimerMs] = useState(0);
  const handoffRef = useRef(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/samples`)
      .then(r => r.json())
      .then(d => setSamples(d.samples || []))
      .catch(() => {});
  }, []);

  const processClaim = async () => {
    setLoading(true);
    setResults(null);
    setAgentStates({});
    setRunMs(null);
    setAgentStartTimes({});
    setAgentElapsed({});
    setActiveAgent(null);
    setLiveTokens('');
    setHandoffs([]);
    setTimerMs(0);
    setActiveTab('overview');

    runStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setTimerMs(Date.now() - runStartRef.current);
    }, 100);

    const agentStart = {};

    try {
      const demoData = await fetch(`${BACKEND_URL}/demo-data?sample=${selectedSample}`).then(r => r.json());
      const response = await fetch(`${BACKEND_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demoData),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.event === 'agent_start') {
              agentStart[event.agent] = Date.now();
              setAgentStartTimes(prev => ({ ...prev, [event.agent]: Date.now() }));
              setActiveAgent(event.agent);
              setLiveTokens('');
              setAgentStates(prev => ({
                ...prev,
                [event.agent]: {
                  status: 'streaming',
                  label: event.label,
                  persona: event.persona,
                  icon: event.icon,
                  color: event.color,
                  model: event.model,
                  tokens: '',
                },
              }));

            } else if (event.event === 'agent_token') {
              setLiveTokens(prev => prev + event.token);
              setAgentStates(prev => ({
                ...prev,
                [event.agent]: { ...prev[event.agent], tokens: (prev[event.agent]?.tokens || '') + event.token },
              }));
              // Track per-agent elapsed while streaming
              if (agentStart[event.agent]) {
                const elapsed = Math.floor((Date.now() - agentStart[event.agent]) / 1000);
                setAgentElapsed(prev => ({ ...prev, [event.agent]: elapsed }));
              }

            } else if (event.event === 'agent_complete') {
              const elapsed = agentStart[event.agent]
                ? Math.floor((Date.now() - agentStart[event.agent]) / 1000)
                : null;
              setAgentElapsed(prev => ({ ...prev, [event.agent]: elapsed }));
              setActiveAgent(null);
              setAgentStates(prev => ({
                ...prev,
                [event.agent]: { ...prev[event.agent], status: 'complete', output: event.output },
              }));

            } else if (event.event === 'error') {
              setActiveAgent(null);
              setAgentStates(prev => ({
                ...prev,
                [event.agent]: { ...prev[event.agent], status: 'error', error: event.message },
              }));

            } else if (event.event === 'agent_handoff') {
              setHandoffs(prev => {
                const next = [...prev, event];
                setTimeout(() => {
                  handoffRef.current?.scrollTo({ top: handoffRef.current.scrollHeight, behavior: 'smooth' });
                }, 50);
                return next;
              });

            } else if (event.event === 'pipeline_complete') {
              setResults(event.results);
              setRunMs(Date.now() - runStartRef.current);
              setLiveTokens('');
              setActiveAgent(null);
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      console.error('Pipeline error:', err);
    } finally {
      clearInterval(timerRef.current);
      setLoading(false);
    }
  };

  const currentSample = samples.find(s => s.sample_id === selectedSample);
  const scenarioLabel = SCENARIO_LABELS[selectedSample] || currentSample?.label || `Sample ${selectedSample}`;
  const scenarioDesc = currentSample?.description || currentSample?.theme || '';

  // Derive executive summary fields from results
  const execSummary = results ? (() => {
    const rawParser = results.ClaimParserAgent || {};
    const parser = (rawParser.claims && rawParser.claims[0]) ? rawParser.claims[0] : rawParser;
    const elig = results.EligibilityAgent || {};
    const adj = results.AdjudicationAgent || {};
    const denial = results.DenialReasoningAgent || {};
    const posting = results.RemittancePostingAgent || {};
    const audit = results.RevenueAuditAgent || {};

    const claimStatus = adj.adjudication_status || (elig.is_eligible === false ? 'DENIED' : 'PENDING');
    const denialCount = denial.total_denial_count || 0;
    const insPayment = posting.claim_totals?.total_insurance_pays ?? adj.claim_totals?.total_insurance_pays ?? null;
    const patientResp = posting.claim_totals?.total_patient_responsibility ?? null;
    const cleanRate = audit.overall_metrics?.clean_claim_rate_pct ?? null;
    const rootIssue = denialCount > 0
      ? (denial.denials?.[0]?.root_cause || 'See denial tab')
      : (parser.flags?.length > 0 ? parser.flags[0]?.message : 'No issues detected');
    const nextAction = denialCount > 0
      ? (denial.denials?.[0]?.recommended_action || 'Review denial tab')
      : 'Claim ready for payment posting';

    return { claimStatus, denialCount, insPayment, patientResp, cleanRate, rootIssue, nextAction };
  })() : null;

  const statusClass = execSummary
    ? execSummary.claimStatus?.toLowerCase().includes('approv') || execSummary.claimStatus?.toLowerCase().includes('paid')
      ? 'status-clean'
      : execSummary.claimStatus?.toLowerCase().includes('denied') || execSummary.claimStatus?.toLowerCase().includes('deny')
        ? 'status-denied'
        : execSummary.claimStatus?.toLowerCase().includes('hold')
          ? 'status-hold'
          : 'status-pending'
    : '';

  return (
    <>
      <header>
        <div className="header-inner">
          <div className="header-brand">
            <div className="tagline">Azure AI Foundry</div>
            <h1>Agentic AI for Revenue Cycle Management</h1>
            <p className="subtitle">
              Six specialized AI agents coordinating eligibility, coding, adjudication, and denial recovery.
              Automating 45 minutes of manual claims work in under 60 seconds.
            </p>
          </div>

          <div className="header-roster">
            <div className="header-roster-title">The Agent Team</div>
            <div className="header-roster-grid">
              {[
                { agent: 'ClaimParserAgent',      name: 'Claim Intake',          persona: 'Sofia' },
                { agent: 'EligibilityAgent',      name: 'Coverage Verification', persona: 'David' },
                { agent: 'AdjudicationAgent',     name: 'Adjudication',          persona: 'Maria' },
                { agent: 'DenialReasoningAgent',  name: 'Denial Prevention',     persona: 'James' },
                { agent: 'RemittancePostingAgent',name: 'Payment Posting',       persona: 'Priya' },
                { agent: 'RevenueAuditAgent',     name: 'Revenue Integrity',     persona: 'Alex'  },
              ].map(({ agent, name, persona }) => (
                <div key={agent} className="header-roster-agent">
                  <span className="roster-icon">{AGENT_ICONS[agent]}</span>
                  <div>
                    <div className="roster-agent-name">{name}</div>
                    <div className="roster-persona-name">{persona}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* KPI hero row */}
      <div className="kpi-row">
        <div className="kpi-chip">
          <div className="kpi-value">60s</div>
          <div className="kpi-label">vs 45 min manual</div>
        </div>
        <div className="kpi-chip">
          <div className="kpi-value">6</div>
          <div className="kpi-label">Specialized Agents</div>
        </div>
        <div className="kpi-chip">
          <div className="kpi-value">35+</div>
          <div className="kpi-label">Edge Cases Handled</div>
        </div>
        <div className="kpi-chip">
          <div className="kpi-value">60%</div>
          <div className="kpi-label">Cost Reduction</div>
        </div>
        <div className="kpi-chip">
          <div className="kpi-value">&lt;5%</div>
          <div className="kpi-label">Manual Review Rate</div>
        </div>
        {runMs && (
          <div className="kpi-chip">
            <div className="kpi-value" style={{ color: '#4ade80' }}>{fmtTimer(runMs)}</div>
            <div className="kpi-label">Last Run Time</div>
          </div>
        )}
      </div>

      <div className="main-layout">

        {/* Controls bar */}
        <div className="controls-bar">
          <div>
            <label>Scenario</label>
            <select value={selectedSample} onChange={e => setSelectedSample(e.target.value)} disabled={loading}>
              {samples.length === 0 && <option value="01">Loading...</option>}
              {samples.map(s => (
                <option key={s.sample_id} value={s.sample_id}>
                  {SCENARIO_LABELS[s.sample_id] || s.label}
                </option>
              ))}
            </select>
            {scenarioDesc && <div className="scenario-desc">{scenarioDesc}</div>}
          </div>

          <button className="btn-process" onClick={processClaim} disabled={loading}>
            {loading ? <><span className="spinner" /> Processing...</> : 'Run Agent Pipeline'}
          </button>

          {(loading || runMs) && (
            <div>
              <div className="run-timer-label">{loading ? 'Elapsed' : 'Total Runtime'}</div>
              <div className="run-timer">{fmtTimer(loading ? timerMs : runMs)}</div>
            </div>
          )}
        </div>

        {/* Scenario story */}
        {SCENARIO_STORIES[selectedSample] && (() => {
          const story = SCENARIO_STORIES[selectedSample];
          return (
            <div className="scenario-story">
              <div className="scenario-story-header">
                <span className="scenario-story-tag">Scenario Context</span>
                <span className="scenario-story-headline">{story.headline}</span>
              </div>
              <div className="scenario-story-body">
                <div className="scenario-story-col">
                  <div className="scenario-story-section-label">The Real-World Problem</div>
                  <p className="scenario-story-text">{story.problem}</p>
                </div>
                <div className="scenario-story-col">
                  <div className="scenario-story-section-label">Agents Carrying the Load</div>
                  <div className="scenario-focus-agents">
                    {story.agentFocus.map(a => (
                      <span key={a} className="scenario-focus-badge">{AGENT_BIZ_LABELS[a]}</span>
                    ))}
                  </div>
                  <p className="scenario-story-text" style={{ marginTop: '8px' }}>{story.focusNote}</p>
                  <div className="scenario-stakes">
                    <span className="scenario-stakes-label">Financial Stakes</span>
                    <span className="scenario-stakes-text">{story.stakes}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Agent pipeline row */}
        <div className="pipeline-section">
          <div className="pipeline-section-title">Agent Pipeline</div>
          <div className="pipeline-row">
            {AGENT_ORDER.map((agent, idx) => {
              const state = agentStates[agent] || {};
              const statusClass2 = state.status || 'idle';
              const elapsed = agentElapsed[agent];
              return (
                <div key={agent} className={`pipeline-agent ${statusClass2}`}>
                  <span className="agent-icon">{AGENT_ICONS[agent]}</span>
                  <div className="agent-biz-label">{AGENT_BIZ_LABELS[agent]}</div>
                  <div className="agent-persona-name">
                    {state.persona ? state.persona.split(',')[0] : ''}
                  </div>
                  {state.model && (
                    <div className="agent-model-badge">{state.model}</div>
                  )}
                  <div className="agent-status-row">
                    <div className="agent-dot" />
                    <span className="agent-elapsed">
                      {state.status === 'streaming' && elapsed !== undefined ? `${elapsed}s` : ''}
                      {state.status === 'complete' && elapsed !== undefined ? fmt(elapsed) : ''}
                      {state.status === 'error' ? 'error' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live token stream */}
        {activeAgent && liveTokens && (
          <div className="streaming-window active">
            <div className="streaming-window-label">
              {AGENT_BIZ_LABELS[activeAgent]} Agent , streaming response
            </div>
            {liveTokens}
          </div>
        )}

        {/* Agent-to-agent handoff feed */}
        {handoffs.length > 0 && (
          <div className="handoff-section">
            <div className="handoff-section-title">Agent Handoff Feed</div>
            <div className="handoff-feed" ref={handoffRef}>
              {handoffs.map((h, i) => (
                <div key={i} className={`handoff-item ${h.escalate ? 'escalate' : ''}`}>
                  <div className="handoff-agents">
                    <span className="handoff-from">{AGENT_BIZ_LABELS[h.from_agent]}</span>
                    <span className="handoff-arrow">{h.escalate ? 'ESCALATE' : 'PASS'}</span>
                    <span className="handoff-to">{AGENT_BIZ_LABELS[h.to_agent]}</span>
                  </div>
                  <div className="handoff-message">{h.message}</div>
                  {h.flags && h.flags.length > 0 && (
                    <div className="handoff-flags">
                      {h.flags.map((f, j) => <span key={j} className="handoff-flag-badge">{f}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tech stack panel */}
        <div className="tech-stack-section">
          <button className="tech-stack-toggle" onClick={() => setShowTechStack(s => !s)}>
            <span>How it works: Azure AI Foundry + Document Intelligence</span>
            <span className="tech-toggle-icon">{showTechStack ? 'v' : '>'}</span>
          </button>
          {showTechStack && (
            <div className="tech-stack-body">
              <div className="tech-stack-intro">
                <p>Each agent runs on Azure OpenAI via Azure AI Foundry. Models are right-sized per task: GPT-4o-mini for structured extraction and summarization, GPT-4o for complex reasoning. The Claim Intake agent performs the same function as Azure Document Intelligence -- extracting structured fields from unstructured medical claim documents -- but using an LLM that also catches semantic errors a pure extraction model would miss.</p>
              </div>
              <div className="tech-agent-grid">
                {AGENT_ORDER.map(agent => {
                  const tech = AGENT_TECH[agent];
                  return (
                    <div key={agent} className="tech-agent-card">
                      <div className="tech-agent-header">
                        <span className="tech-agent-icon">{AGENT_ICONS[agent]}</span>
                        <div>
                          <div className="tech-agent-name">{AGENT_BIZ_LABELS[agent]}</div>
                          <div className="tech-agent-role">{tech.role}</div>
                        </div>
                        <span className="tech-model-badge">{tech.model}</span>
                      </div>
                      <div className="tech-why"><strong>Why {tech.model}:</strong> {tech.why}</div>
                      <div className="tech-di-note">{tech.diNote}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Results + Executive Summary */}
        <div className="results-area">

          {/* Main results panel */}
          <div className="results-panel">
            {!results && Object.keys(agentStates).length === 0 ? (
              <div className="no-results">
                <div className="no-results-icon">⚕️</div>
                <p>Select a scenario and click <strong>Run Agent Pipeline</strong> to process a claim through all 6 AI agents.</p>
              </div>
            ) : (
              <>
                <div className="tabs">
                  {[
                    { id: 'overview', label: 'Overview' },
                    { id: 'parser',   label: 'Claim Intake' },
                    { id: 'adjudication', label: 'Adjudication' },
                    { id: 'denial',   label: 'Denials' },
                    { id: 'posting',  label: 'Payment' },
                    { id: 'audit',    label: 'Revenue Audit' },
                  ].map(t => (
                    <button key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="tab-content">
                  {/* Overview */}
                  {activeTab === 'overview' && (
                    <div>
                      <div className="metric-grid">
                        {results?.ClaimParserAgent && (
                          <div className="metric-card">
                            <h3>Parse Status</h3>
                            <div className={`value ${results.ClaimParserAgent.is_clean ? 'green' : 'red'}`}>
                              {results.ClaimParserAgent.is_clean ? 'Clean' : 'Flagged'}
                            </div>
                          </div>
                        )}
                        {results?.EligibilityAgent && (
                          <div className="metric-card">
                            <h3>Coverage</h3>
                            <div className={`value ${results.EligibilityAgent.is_eligible ? 'green' : 'red'}`}>
                              {results.EligibilityAgent.is_eligible ? 'Eligible' : 'Ineligible'}
                            </div>
                          </div>
                        )}
                        {results?.AdjudicationAgent && (
                          <div className="metric-card">
                            <h3>Adjudication</h3>
                            <div className="value teal" style={{ fontSize: '16px' }}>
                              {results.AdjudicationAgent.adjudication_status}
                            </div>
                          </div>
                        )}
                        {results?.DenialReasoningAgent && (
                          <div className="metric-card">
                            <h3>Denials</h3>
                            <div className={`value ${results.DenialReasoningAgent.total_denial_count > 0 ? 'red' : 'green'}`}>
                              {results.DenialReasoningAgent.total_denial_count}
                            </div>
                          </div>
                        )}
                        {results?.RevenueAuditAgent && (
                          <div className="metric-card">
                            <h3>Clean Rate</h3>
                            <div className="value teal">
                              {results.RevenueAuditAgent.overall_metrics?.clean_claim_rate_pct?.toFixed(1)}%
                            </div>
                          </div>
                        )}
                        {results?.RemittancePostingAgent && (
                          <div className="metric-card">
                            <h3>Ins. Pays</h3>
                            <div className="value green">
                              ${results.RemittancePostingAgent.claim_totals?.total_insurance_pays?.toFixed(0)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Claim Intake / Parser */}
                  {activeTab === 'parser' && results?.ClaimParserAgent && (() => {
                    // Normalize: agent may return flat object or {claims:[...]} if it mirrored input
                    const raw = results.ClaimParserAgent;
                    const p = (raw.claims && raw.claims[0]) ? raw.claims[0] : raw;
                    return (
                      <div>
                        <div className="info-row"><span className="i-label">Claim ID</span><span className="i-value">{p.claim_id || 'n/a'}</span></div>
                        <div className="info-row"><span className="i-label">Patient</span><span className="i-value">{p.patient?.name || 'n/a'}</span></div>
                        <div className="info-row"><span className="i-label">Provider</span><span className="i-value">{p.provider?.provider_name || 'n/a'}</span></div>
                        <div className="info-row"><span className="i-label">Total Charge</span><span className="i-value">${p.total_charge != null ? Number(p.total_charge).toFixed(2) : '0.00'}</span></div>
                        <div className="info-row"><span className="i-label">Service Lines</span><span className="i-value">{p.service_lines?.length ?? 'n/a'}</span></div>
                        <div className="info-row"><span className="i-label">Submission Date</span><span className="i-value">{p.submission_date || 'n/a'}</span></div>
                        <div className="info-row"><span className="i-label">Parse Result</span><span className="i-value">{p.is_clean ? 'Clean' : p.is_clean === false ? 'Has flags' : 'n/a'}</span></div>
                        {p.flags?.length > 0 && (
                          <div className="flag-list">
                            <h4>Flags ({p.flags.length})</h4>
                            <ul>
                              {p.flags.map((f, i) => (
                                <li key={i}><strong>{f.flag_code}</strong>: {f.message}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Adjudication */}
                  {activeTab === 'adjudication' && results?.AdjudicationAgent && (
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Line</th><th>CPT</th><th>Billed</th><th>Allowed</th><th>Writeoff</th><th>Insurance</th><th>Patient</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.AdjudicationAgent.service_lines?.map((line, i) => (
                            <tr key={i}>
                              <td>{line.line_number}</td>
                              <td>{line.cpt_code}</td>
                              <td>${line.billed_amount?.toFixed(2)}</td>
                              <td>${line.allowed_amount?.toFixed(2)}</td>
                              <td>${line.provider_writeoff?.toFixed(2)}</td>
                              <td>${line.insurance_pays?.toFixed(2)}</td>
                              <td>${line.patient_pays?.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Denials */}
                  {activeTab === 'denial' && results?.DenialReasoningAgent && (
                    results.DenialReasoningAgent.total_denial_count === 0 ? (
                      <div className="no-results" style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '8px' }}>
                        <p style={{ color: '#4ade80' }}>No denials detected for this claim.</p>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table>
                          <thead>
                            <tr><th>Line</th><th>CPT</th><th>Denial Code</th><th>Root Cause</th><th>Action</th></tr>
                          </thead>
                          <tbody>
                            {results.DenialReasoningAgent.denials?.map((d, i) => (
                              <tr key={i}>
                                <td>{d.line_number}</td>
                                <td>{d.cpt_code}</td>
                                <td><strong style={{ color: '#f87171' }}>{d.denial_code}</strong></td>
                                <td style={{ fontSize: '12px' }}>{d.root_cause}</td>
                                <td><span className="badge denied">{d.recommended_action}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}

                  {/* Payment Posting */}
                  {activeTab === 'posting' && results?.RemittancePostingAgent && (
                    <div>
                      <div className="posting-summary">
                        <div className="posting-card insurance">
                          <div className="p-label">Insurance Pays</div>
                          <div className="p-value">${results.RemittancePostingAgent.claim_totals?.total_insurance_pays?.toFixed(2)}</div>
                        </div>
                        <div className="posting-card patient">
                          <div className="p-label">Patient Responsibility</div>
                          <div className="p-value">${results.RemittancePostingAgent.claim_totals?.total_patient_responsibility?.toFixed(2)}</div>
                        </div>
                      </div>
                      <table>
                        <thead>
                          <tr><th>Account</th><th>Type</th><th>Amount</th></tr>
                        </thead>
                        <tbody>
                          {results.RemittancePostingAgent.gl_entries?.map((e, i) => (
                            <tr key={i}>
                              <td>{e.account_name}</td>
                              <td>{e.debit > 0 ? 'Debit' : 'Credit'}</td>
                              <td>${Math.abs(e.debit || e.credit || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Revenue Audit */}
                  {activeTab === 'audit' && results?.RevenueAuditAgent && (
                    <div>
                      <div className="metric-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="metric-card">
                          <h3>Clean Claim Rate</h3>
                          <div className="value green">{results.RevenueAuditAgent.overall_metrics?.clean_claim_rate_pct?.toFixed(1)}%</div>
                        </div>
                        <div className="metric-card">
                          <h3>Denial Rate</h3>
                          <div className="value red">{results.RevenueAuditAgent.overall_metrics?.denied_claim_rate_pct?.toFixed(1)}%</div>
                        </div>
                        <div className="metric-card">
                          <h3>Total Billed</h3>
                          <div className="value">${results.RevenueAuditAgent.overall_metrics?.total_billed?.toFixed(0)}</div>
                        </div>
                        <div className="metric-card">
                          <h3>Insurance Pays</h3>
                          <div className="value teal">${results.RevenueAuditAgent.overall_metrics?.total_insurance_payment?.toFixed(0)}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Executive summary sidebar */}
          <div className="exec-summary">
            <div className="exec-summary-header">
              <h3>Executive Summary</h3>
            </div>
            {execSummary ? (
              <div className="exec-summary-body">
                <div className="exec-row">
                  <div className="exec-row-label">Claim Status</div>
                  <div className={`exec-row-value ${statusClass}`}>{execSummary.claimStatus}</div>
                </div>
                <div className="exec-row">
                  <div className="exec-row-label">Denial Risk</div>
                  <div className={`exec-row-value ${execSummary.denialCount > 0 ? 'status-denied' : 'status-clean'}`}>
                    {execSummary.denialCount > 0 ? `${execSummary.denialCount} denial(s) found` : 'No denials'}
                  </div>
                </div>
                <div className="exec-row">
                  <div className="exec-row-label">Root Issue</div>
                  <div className="exec-row-value">{execSummary.rootIssue}</div>
                </div>
                <div className="exec-row">
                  <div className="exec-row-label">Recommended Action</div>
                  <div className="exec-row-value">{execSummary.nextAction}</div>
                </div>
                {execSummary.cleanRate !== null && (
                  <div className="exec-row">
                    <div className="exec-row-label">Clean Claim Rate</div>
                    <div className="exec-row-value">{execSummary.cleanRate?.toFixed(1)}%</div>
                  </div>
                )}
                {(execSummary.insPayment !== null || execSummary.patientResp !== null) && (
                  <div className="exec-financial">
                    {execSummary.insPayment !== null && (
                      <div className="exec-financial-row">
                        <span className="f-label">Insurance Pays</span>
                        <span className="f-value green">${execSummary.insPayment?.toFixed(2)}</span>
                      </div>
                    )}
                    {execSummary.patientResp !== null && (
                      <div className="exec-financial-row">
                        <span className="f-label">Patient Owes</span>
                        <span className="f-value amber">${execSummary.patientResp?.toFixed(2)}</span>
                      </div>
                    )}
                    {runMs && (
                      <div className="exec-financial-row">
                        <span className="f-label">Processed In</span>
                        <span className="f-value">{fmtTimer(runMs)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="exec-placeholder">
                Run a claim to see the executive summary with status, risk score, root issue, and financial impact.
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Footer , real-world business use cases */}
      <footer>
        <div className="footer-inner">
          <div className="footer-title">Real-World Business Impact</div>
          <div className="use-cases-grid">
            <div className="use-case-card">
              <div className="uc-icon">⚡</div>
              <div className="uc-title">Faster Cash Flow</div>
              <div className="uc-desc">Claims adjudicated in seconds instead of days, reducing days-in-AR and accelerating revenue recognition.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">🛡️</div>
              <div className="uc-title">Denial Prevention</div>
              <div className="uc-desc">AI detects coding errors, missing prior auth, and eligibility gaps before submission, cutting denial rate by up to 40%.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">📋</div>
              <div className="uc-title">Audit & Compliance</div>
              <div className="uc-desc">Every adjudication decision is fully traceable with reasoning and rule references , exactly what regulators require.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">💰</div>
              <div className="uc-title">Cost Efficiency</div>
              <div className="uc-desc">Right-sized models (GPT-4o-mini for routine tasks, GPT-4o for complex logic) cut AI inference cost by 60%.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">🔄</div>
              <div className="uc-title">Scalable Operations</div>
              <div className="uc-desc">Process thousands of claims simultaneously without adding headcount , built for enterprise-scale RCM teams.</div>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
