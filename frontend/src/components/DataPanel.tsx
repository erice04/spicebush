import "./DataPanel.css";

interface DataPanelProps {
  apiConnecting?: boolean;
}

export default function DataPanel({ apiConnecting = false }: DataPanelProps) {
  return (
    <button
      type="button"
      className="data-panel__tab"
      onClick={() => {
        window.open(`${window.location.origin}/data`, "_blank", "noopener,noreferrer");
      }}
      aria-label={
        apiConnecting
          ? "Open data editor (server waking)"
          : "Open data editor in a new tab"
      }
      title={apiConnecting ? "Server waking…" : undefined}
    >
      {apiConnecting && <span className="ui-spinner" aria-hidden="true" />}
      Data
    </button>
  );
}
