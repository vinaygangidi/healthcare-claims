'use client';

import { useState, useEffect, useRef } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8002';

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
  const runStartRef = useRef(null);
  const timerRef = useRef(null);
  const [timerMs, setTimerMs] = useState(0);

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
    const parser = results.ClaimParserAgent || {};
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
            <div className="tagline">AI Health Agents</div>
            <h1>Agentic AI for Revenue Cycle Management</h1>
            <p className="subtitle">
              Multi-agent AI coordinating eligibility, coding, adjudication, and denial recovery
              — automating 45 minutes of manual work in under 60 seconds.
            </p>
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
              {AGENT_BIZ_LABELS[activeAgent]} Agent — streaming response
            </div>
            {liveTokens}
          </div>
        )}

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
                  {activeTab === 'parser' && results?.ClaimParserAgent && (
                    <div>
                      <div className="info-row"><span className="i-label">Claim ID</span><span className="i-value">{results.ClaimParserAgent.claim_id || 'n/a'}</span></div>
                      <div className="info-row"><span className="i-label">Patient</span><span className="i-value">{results.ClaimParserAgent.patient?.name || 'n/a'}</span></div>
                      <div className="info-row"><span className="i-label">Provider</span><span className="i-value">{results.ClaimParserAgent.provider?.provider_name || 'n/a'}</span></div>
                      <div className="info-row"><span className="i-label">Total Charge</span><span className="i-value">${results.ClaimParserAgent.total_charge?.toFixed(2) || '0.00'}</span></div>
                      <div className="info-row"><span className="i-label">Service Lines</span><span className="i-value">{results.ClaimParserAgent.service_lines?.length ?? 'n/a'}</span></div>
                      {results.ClaimParserAgent.flags?.length > 0 && (
                        <div className="flag-list">
                          <h4>Flags ({results.ClaimParserAgent.flags.length})</h4>
                          <ul>
                            {results.ClaimParserAgent.flags.map((f, i) => (
                              <li key={i}><strong>{f.flag_code}</strong>: {f.message}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

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

      {/* Footer — real-world business use cases */}
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
              <div className="uc-desc">Every adjudication decision is fully traceable with reasoning and rule references — exactly what regulators require.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">💰</div>
              <div className="uc-title">Cost Efficiency</div>
              <div className="uc-desc">Right-sized models (GPT-4o-mini for routine tasks, GPT-4o for complex logic) cut AI inference cost by 60%.</div>
            </div>
            <div className="use-case-card">
              <div className="uc-icon">🔄</div>
              <div className="uc-title">Scalable Operations</div>
              <div className="uc-desc">Process thousands of claims simultaneously without adding headcount — built for enterprise-scale RCM teams.</div>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
