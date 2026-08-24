import { Component } from 'react';

/**
 * Something to look at when the app breaks.
 *
 * React unmounts the whole tree when a render throws, so a single bad row in two years of data can
 * turn the page into a black rectangle — which is exactly what happened when an export arrived with
 * its columns renamed and thousands of rows carried no pay month. A blank page tells you nothing,
 * offers nothing, and cannot even be reported accurately.
 *
 * So the tree gets a floor. It says what broke, keeps the two doors that do not depend on the
 * broken render — a reload and a sign-out — and shows the actual error, because the person reading
 * it is the person who can pass it on. It is deliberately plain: no glass, no motion, nothing that
 * could itself fail.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The console is where a person looking for the cause will go first.
    console.error('The app failed to render:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', background: '#08080a', color: '#f5f5f7', padding: '48px 20px', fontFamily: 'Onest, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            The app could not draw this data.
          </h1>
          <p style={{ marginTop: 14, lineHeight: 1.6, color: 'rgba(235,235,245,0.68)' }}>
            Something in what is stored is not what the app expects, so it stopped rather than show
            you numbers it could not stand behind. Your data has not been changed by this.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ minHeight: 44, padding: '0 18px', borderRadius: 999, border: 0, background: '#0a84ff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Reload
            </button>
            <a
              href="/api/export.csv"
              download
              style={{ minHeight: 44, padding: '0 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', color: '#f5f5f7', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              Download my data
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
                } finally {
                  window.location.reload();
                }
              }}
              style={{ minHeight: 44, padding: '0 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'rgba(235,235,245,0.68)', fontSize: 14, cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
          <pre
            style={{ marginTop: 26, padding: 14, background: 'rgba(255,255,255,0.05)', borderRadius: 12, fontSize: 12, lineHeight: 1.5, color: 'rgba(235,235,245,0.68)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {String(error?.stack || error?.message || error)}
          </pre>
        </div>
      </div>
    );
  }
}
