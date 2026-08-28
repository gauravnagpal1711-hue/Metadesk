import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';
import CampaignFilter from '../components/CampaignFilter.jsx';

const RANGES = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time']
];

function pct(x) {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}
function days(x) {
  return x == null ? '—' : `${x < 10 ? x.toFixed(1) : Math.round(x)}d`;
}

export default function Insights({ campaigns = [], syncSignal }) {
  const [range, setRange] = useState('30');
  const [campaignFilter, setCampaignFilter] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams();
      if (range !== 'all') {
        const from = new Date(Date.now() - Number(range) * 86400000);
        p.set('from', from.toISOString());
      }
      campaignFilter.forEach((c) => p.append('campaign', c));
      setData(await api.get(`/leads/analytics?${p.toString()}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [range, campaignFilter]);

  useEffect(() => { load(); }, [load, syncSignal]);

  const campaignNames = useMemo(
    () => [...new Set(campaigns.map((c) => c.name).filter(Boolean))].sort(),
    [campaigns]
  );

  if (!data && loading) return <div className="insights"><div className="mono-label">Loading…</div></div>;
  if (error) return <div className="insights"><div className="notice bad">{error}</div></div>;
  if (!data) return null;

  const funnelMax = Math.max(1, ...data.funnel.map((s) => s.count));
  const sourceMax = Math.max(1, ...data.by_source.map((s) => s.count));
  const campMax = Math.max(1, ...data.by_campaign.map((s) => s.count));
  const reasonMax = Math.max(1, ...data.lost.reasons.map((r) => r.count));

  return (
    <div className="insights">
      <div className="insights-bar">
        <div className="layout-toggle">
          {RANGES.map(([v, l]) => (
            <button key={v} className={`btn sm ${range === v ? 'primary' : ''}`} onClick={() => setRange(v)}>{l}</button>
          ))}
        </div>
        <CampaignFilter options={campaignNames} selected={campaignFilter} onChange={setCampaignFilter} />
        <span className="mono-label" style={{ marginLeft: 'auto' }}>
          {data.total} LEADS IN RANGE{loading ? ' · …' : ''}
        </span>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="k">Open pipeline</div>
          <div className="v">₹{money(data.open.value)} <span className="sub">/ {data.open.count}</span></div>
        </div>
        <div className="kpi">
          <div className="k">Win rate</div>
          <div className="v">{pct(data.win_rate)}</div>
        </div>
        <div className="kpi">
          <div className="k">Won value</div>
          <div className="v">₹{money(data.won.value)} <span className="sub">/ {data.won.count}</span></div>
        </div>
        <div className="kpi">
          <div className="k">Avg deal size</div>
          <div className="v">{data.won.avg_value ? `₹${money(data.won.avg_value)}` : '—'}</div>
        </div>
        <div className="kpi">
          <div className="k">New this week</div>
          <div className="v">{data.new_leads.this_week} <span className="sub">/ {data.new_leads.this_month} mo</span></div>
        </div>
        <div className="kpi">
          <div className="k">Stale (7d+ silent)</div>
          <div className="v">{data.stale}</div>
        </div>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="k">Avg days to won</div>
          <div className="v">{days(data.velocity?.avg_days_to_won)}</div>
        </div>
        <div className="kpi">
          <div className="k">Avg days to first contact</div>
          <div className="v">{days(data.velocity?.avg_days_to_contact)}</div>
        </div>
        <div className="kpi">
          <div className="k">Avg age in current stage</div>
          <div className="v">{days(data.velocity?.avg_days_in_stage)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Funnel</h3>
        <div className="funnel">
          {data.funnel.map((s) => (
            <div key={s.stage_id} className="funnel-row">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <div className="funnel-track">
                <div className="funnel-fill" style={{ width: `${(s.count / funnelMax) * 100}%`, background: s.color || 'var(--accent)' }} />
              </div>
              <span className="funnel-conv">
                {s.count}{s.conversion_to_next != null ? ` · ${pct(s.conversion_to_next)}↓` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="insights-cols">
        <div className="panel">
          <h3>Leads by source</h3>
          <div className="bar-list">
            {data.by_source.map((s) => (
              <div key={s.source} className="bar-item">
                <span style={{ textTransform: 'capitalize' }}>{s.source}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / sourceMax) * 100}%` }} /></div>
                <span className="bar-num">{s.count}</span>
              </div>
            ))}
            {data.by_source.length === 0 && <div className="empty-mini">No leads in range.</div>}
          </div>
        </div>

        <div className="panel">
          <h3>Top campaigns</h3>
          <div className="bar-list">
            {data.by_campaign.map((c) => (
              <div key={c.campaign_name} className="bar-item" title={`${c.won} won · ₹${money(c.won_value)}`}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaign_name}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.count / campMax) * 100}%` }} /></div>
                <span className="bar-num">{c.count}</span>
              </div>
            ))}
            {data.by_campaign.length === 0 && <div className="empty-mini">No leads in range.</div>}
          </div>
        </div>

        <div className="panel">
          <h3>Lost reasons</h3>
          <div className="bar-list">
            {data.lost.reasons.map((r) => (
              <div key={r.reason} className="bar-item">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.count / reasonMax) * 100}%`, background: 'var(--danger)' }} /></div>
                <span className="bar-num">{r.count}</span>
              </div>
            ))}
            {data.lost.reasons.length === 0 && <div className="empty-mini">No lost leads in range.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
