import { AlertTriangle } from "lucide-react";

export function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric-card">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="section-title">
      <Icon size={20} />
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function InfoColumns({ columns }) {
  return (
    <div className="info-columns">
      {columns.map(([title, items]) => (
        <div key={title}>
          <h3>{title}</h3>
          <ul>
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, tone }) {
  return (
    <div className="progress">
      <div style={{ width: `${value}%` }} className={tone} />
      <span>{value}%</span>
    </div>
  );
}

export function EmptyState({ message }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={18} />
      <span>{message}</span>
    </div>
  );
}

