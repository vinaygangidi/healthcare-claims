'use client';

import { useState, useEffect } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8002';

export default function Home() {
  const [samples, setSamples] = useState([]);
  const [selectedSample, setSelectedSample] = useState('01');
  const [loading, setLoading] = useState(false);
  const [agentStates, setAgentStates] = useState({});
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Load available samples
  useEffect(() => {
    fetch(`${BACKEND_URL}/samples`)
      .then(r => r.json())
      .then(d => setSamples(d.samples || []))
      .catch(err => console.error('Error loading samples:', err));
  }, []);

  const processClaim = async () => {
    setLoading(true);
    setResults(null);
    setAgentStates({});

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
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              if (event.event === 'agent_start') {
                setAgentStates(prev => ({
                  ...prev,
                  [event.agent]: { status: 'streaming', label: event.label, icon: event.icon, color: event.color, tokens: '' },
                }));
              } else if (event.event === 'agent_token') {
                setAgentStates(prev => ({
                  ...prev,
                  [event.agent]: { ...prev[event.agent], tokens: (prev[event.agent]?.tokens || '') + event.token },
                }));
              } else if (event.event === 'agent_complete') {
                setAgentStates(prev => ({
                  ...prev,
                  [event.agent]: { ...prev[event.agent], status: 'complete', output: event.output },
                }));
              } else if (event.event === 'error') {
                setAgentStates(prev => ({
                  ...prev,
                  [event.agent]: { ...prev[event.agent], status: 'error', error: event.message },
                }));
              } else if (event.event === 'pipeline_complete') {
                setResults(event.results);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing claim:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSampleLabel = () => {
    const sample = samples.find(s => s.sample_id === selectedSample);
    return sample ? sample.label : 'Sample ' + selectedSample;
  };

  return (
    <>
      <header>
        <div className="container">
          <h1>Healthcare Claims Processing</h1>
          <p>Multi-agent AI system for claim adjudication and denial management</p>
        </div>
      </header>

      <div className="container">
        <div className="content">
          {/* Left: Controls */}
          <div className="panel">
            <h2>Process Claim</h2>

            <div className="sample-select">
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                Select Test Scenario:
              </label>
              <select value={selectedSample} onChange={e => setSelectedSample(e.target.value)} disabled={loading}>
                {samples.map(s => (
                  <option key={s.sample_id} value={s.sample_id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {samples.find(s => s.sample_id === selectedSample) && (
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px', padding: '10px', background: '#f9fafb', borderRadius: '4px' }}>
                  <strong>{samples.find(s => s.sample_id === selectedSample).theme}</strong>
                  <p style={{ marginTop: '4px', lineHeight: 1.4 }}>{samples.find(s => s.sample_id === selectedSample).description}</p>
                </div>
              )}
            </div>

            <button onClick={processClaim} disabled={loading} style={{ width: '100%', marginBottom: '20px' }}>
              {loading ? <>Processing...</> : 'Process Claim'}
            </button>

            {/* Agent Pipeline Status */}
            <div>
              <h2 style={{ marginTop: '20px', marginBottom: '10px' }}>Agent Pipeline</h2>
              <ul className="agent-list">
                {['ClaimParserAgent', 'EligibilityAgent', 'AdjudicationAgent', 'DenialReasoningAgent', 'RemittancePostingAgent', 'RevenueAuditAgent'].map(agent => {
                  const state = agentStates[agent] || {};
                  const statusClass = state.status === 'streaming' ? 'streaming' : state.status === 'complete' ? 'complete' : state.status === 'error' ? 'error' : '';

                  return (
                    <li key={agent} className={`agent-item ${statusClass}`}>
                      <span className="status-icon">
                        {state.status === 'streaming' ? <span className="spinner" /> : state.status === 'complete' ? '[OK]' : state.status === 'error' ? '[X]' : '[ ]'}
                      </span>
                      <span style={{ flex: 1 }}>
                        <strong>{state.label || agent}</strong>
                        {state.error && <div style={{ color: '#dc2626', fontSize: '11px', marginTop: '2px' }}>{state.error}</div>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Right: Results */}
          <div className="panel">
            <h2>Results</h2>

            {!results && Object.keys(agentStates).length === 0 && (
              <div className="no-results">
                <p>Select a scenario and click "Process Claim" to see results</p>
              </div>
            )}

            {results && (
              <>
                {/* Tabs */}
                <div className="tabs">
                  <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                    Overview
                  </button>
                  <button className={`tab ${activeTab === 'parser' ? 'active' : ''}`} onClick={() => setActiveTab('parser')}>
                    Parser
                  </button>
                  <button className={`tab ${activeTab === 'adjudication' ? 'active' : ''}`} onClick={() => setActiveTab('adjudication')}>
                    Adjudication
                  </button>
                  <button className={`tab ${activeTab === 'denial' ? 'active' : ''}`} onClick={() => setActiveTab('denial')}>
                    Denial
                  </button>
                  <button className={`tab ${activeTab === 'posting' ? 'active' : ''}`} onClick={() => setActiveTab('posting')}>
                    Posting
                  </button>
                  <button className={`tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
                    Audit
                  </button>
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <div>
                    <div className="results-panel">
                      {results.ClaimParserAgent && (
                        <div className="metric-card">
                          <h3>Parse Status</h3>
                          <div className="value" style={{ color: results.ClaimParserAgent.is_clean ? '#16a34a' : '#dc2626' }}>
                            {results.ClaimParserAgent.is_clean ? 'Clean' : 'Has Flags'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                            {results.ClaimParserAgent.flags?.length || 0} flags
                          </div>
                        </div>
                      )}

                      {results.EligibilityAgent && (
                        <div className="metric-card">
                          <h3>Eligibility</h3>
                          <div className="value" style={{ color: results.EligibilityAgent.is_eligible ? '#16a34a' : '#dc2626' }}>
                            {results.EligibilityAgent.is_eligible ? 'Eligible' : 'Not Eligible'}
                          </div>
                        </div>
                      )}

                      {results.AdjudicationAgent && (
                        <div className="metric-card">
                          <h3>Adjudication</h3>
                          <div className="value">{results.AdjudicationAgent.adjudication_status}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '5px' }}>
                            ${results.AdjudicationAgent.claim_totals?.total_insurance_pays?.toFixed(2) || '0.00'}
                          </div>
                        </div>
                      )}

                      {results.DenialReasoningAgent && (
                        <div className="metric-card">
                          <h3>Denials</h3>
                          <div className="value">{results.DenialReasoningAgent.total_denial_count}</div>
                        </div>
                      )}

                      {results.RevenueAuditAgent && (
                        <div className="metric-card">
                          <h3>Clean Rate</h3>
                          <div className="value">{results.RevenueAuditAgent.overall_metrics?.clean_claim_rate_pct?.toFixed(1) || '0'}%</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Parser Tab */}
                {activeTab === 'parser' && results.ClaimParserAgent && (
                  <div>
                    <div style={{ fontSize: '13px', color: '#4b5563' }}>
                      <p><strong>Claim ID:</strong> {results.ClaimParserAgent.claim_id}</p>
                      <p><strong>Patient:</strong> {results.ClaimParserAgent.patient?.name}</p>
                      <p><strong>Provider:</strong> {results.ClaimParserAgent.provider?.provider_name}</p>
                      <p><strong>Total Charge:</strong> ${results.ClaimParserAgent.total_charge?.toFixed(2)}</p>
                      {results.ClaimParserAgent.flags?.length > 0 && (
                        <div style={{ marginTop: '10px', padding: '10px', background: '#fee2e2', borderRadius: '4px' }}>
                          <strong>Flags:</strong>
                          <ul style={{ marginLeft: '20px', marginTop: '5px' }}>
                            {results.ClaimParserAgent.flags.map((flag, i) => (
                              <li key={i} style={{ fontSize: '12px' }}>
                                {flag.flag_code}: {flag.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Adjudication Tab */}
                {activeTab === 'adjudication' && results.AdjudicationAgent && (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>CPT</th>
                          <th>Billed</th>
                          <th>Allowed</th>
                          <th>Writeoff</th>
                          <th>Insurance</th>
                          <th>Patient</th>
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

                {/* Denial Tab */}
                {activeTab === 'denial' && results.DenialReasoningAgent && (
                  <div>
                    {results.DenialReasoningAgent.total_denial_count === 0 ? (
                      <div className="no-results" style={{ background: '#dcfce7' }}>
                        <p>No denials for this claim</p>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table>
                          <thead>
                            <tr>
                              <th>Line</th>
                              <th>CPT</th>
                              <th>Denial Code</th>
                              <th>Reason</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.DenialReasoningAgent.denials?.map((denial, i) => (
                              <tr key={i}>
                                <td>{denial.line_number}</td>
                                <td>{denial.cpt_code}</td>
                                <td><strong>{denial.denial_code}</strong></td>
                                <td style={{ fontSize: '12px' }}>{denial.root_cause}</td>
                                <td><span className="badge denied">{denial.recommended_action}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Posting Tab */}
                {activeTab === 'posting' && results.RemittancePostingAgent && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                      <div style={{ padding: '10px', background: '#dcfce7', borderRadius: '4px' }}>
                        <strong style={{ color: '#166534' }}>Insurance Pays</strong>
                        <div style={{ fontSize: '18px', color: '#166534', fontWeight: 'bold' }}>
                          ${results.RemittancePostingAgent.claim_totals?.total_insurance_pays?.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ padding: '10px', background: '#e0e7ff', borderRadius: '4px' }}>
                        <strong style={{ color: '#3730a3' }}>Patient Responsibility</strong>
                        <div style={{ fontSize: '18px', color: '#3730a3', fontWeight: 'bold' }}>
                          ${results.RemittancePostingAgent.claim_totals?.total_patient_responsibility?.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: '10px', background: '#f9fafb', borderRadius: '4px', fontSize: '13px' }}>
                      <strong>GL Entries:</strong>
                      <ul style={{ marginLeft: '20px', marginTop: '8px', fontSize: '12px' }}>
                        {results.RemittancePostingAgent.gl_entries?.map((entry, i) => (
                          <li key={i}>
                            {entry.account_name}: {entry.debit > 0 ? `Debit` : `Credit`} ${Math.abs(entry.debit || entry.credit).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Audit Tab */}
                {activeTab === 'audit' && results.RevenueAuditAgent && (
                  <div>
                    <div className="results-panel" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <div className="metric-card">
                        <h3>Clean Claim Rate</h3>
                        <div className="value" style={{ color: '#16a34a' }}>{results.RevenueAuditAgent.overall_metrics?.clean_claim_rate_pct?.toFixed(1)}%</div>
                      </div>
                      <div className="metric-card">
                        <h3>Denial Rate</h3>
                        <div className="value" style={{ color: '#dc2626' }}>{results.RevenueAuditAgent.overall_metrics?.denied_claim_rate_pct?.toFixed(1)}%</div>
                      </div>
                      <div className="metric-card">
                        <h3>Total Billed</h3>
                        <div className="value">${results.RevenueAuditAgent.overall_metrics?.total_billed?.toFixed(0)}</div>
                      </div>
                      <div className="metric-card">
                        <h3>Insurance Pays</h3>
                        <div className="value">${results.RevenueAuditAgent.overall_metrics?.total_insurance_payment?.toFixed(0)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
