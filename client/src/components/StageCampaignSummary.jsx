import { useRef, useState } from 'react';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

function StageSummaryItem({ stage, leads, onPickCampaign }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, open, () => setOpen(false));

  const byCampaign = {};
  for (const l of leads) {
    const key = l.campaign_name || 'No campaign';
    byCampaign[key] = (byCampaign[key] || 0) + 1;
  }
  const entries = Object.entries(byCampaign).sort((a, b) => b[1] - a[1]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="stage-summary-btn" onClick={() => setOpen((o) => !o)}>
        <span className="k">
          <span className="dot" style={{ background: stage.color }} />
          {stage.name}
          <span className="chev">{open ? '▲' : '▼'}</span>
        </span>
        <div className="v">{leads.length}</div>
      </button>
      {open && (
        <div className="dropdown-pop" style={{ left: 0 }}>
          {entries.length === 0 ? (
            <div className="empty-mini">No leads in this stage.</div>
          ) : (
            entries.map(([name, count]) => (
              <button key={name} className="dropdown-check-row" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => onPickCampaign?.(name)}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span className="num" style={{ color: 'var(--muted-2)' }}>{count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Stage-wise lead counts as big tiles (matching the old metrics-strip look), each
 * expandable to a per-campaign breakdown. Clicking a campaign in the breakdown
 * applies it to the campaign filter above the board. */
export default function StageCampaignSummary({ stages, leads, onPickCampaign }) {
  return (
    <div className="stage-summary-row">
      {stages.map((stage) => (
        <StageSummaryItem
          key={stage.id}
          stage={stage}
          leads={leads.filter((l) => l.stage_id === stage.id)}
          onPickCampaign={onPickCampaign}
        />
      ))}
    </div>
  );
}
