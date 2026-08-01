export function Logo() {
  return (
    <button
      type="button"
      className="brand"
      aria-label="Reload B9T9"
      title="Reload B9T9"
      onClick={() => window.location.reload()}
    >
      <img className="brand-logo" src="/b9t9-logo.webp" alt="B9T9" />
    </button>
  );
}
