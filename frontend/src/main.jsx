import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Shows the error on screen instead of a blank page if a component throws while rendering.
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[Quiz Duel] render error", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card error-card">
          <h2>Something went wrong</h2>
          <pre>{String(this.state.error?.message ?? this.state.error)}</pre>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
