import { createKit } from '@plurid/aptuitive-react';

// #region kit
// The design system's parts, mapped one at a time; the rest of the default kit stays.
export const kit = createKit({
  Title: ({ children }) => <h1 className="page-title">{children}</h1>,
  Section: ({ title, children }) => (
    <section className="card">
      {title && <h2 className="card-title">{title}</h2>}
      <div className="card-body">{children}</div>
    </section>
  ),
  Button: ({ children, onClick, tone = 'plain', disabled, type = 'button' }) => (
    <button type={type} className={`button button-${tone}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Notice: ({ tone, children }) => (
    <p className={`notice notice-${tone}`} role="status">
      {children}
    </p>
  ),
});
// #endregion
