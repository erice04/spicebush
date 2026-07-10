import "./DataPanel.css";

export default function DataPanel() {
  return (
    <button
      type="button"
      className="data-panel__tab"
      onClick={() => {
        window.open(`${window.location.origin}/data`, "_blank", "noopener,noreferrer");
      }}
      aria-label="Open data editor in a new tab"
    >
      Data
    </button>
  );
}
