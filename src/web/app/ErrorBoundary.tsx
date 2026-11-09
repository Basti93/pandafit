import { Component, type ReactNode } from 'react';
import { Training } from './Training';

/** A broken page never leaves a white screen: a calm message, and the way to the workout stays open. */
export class ErrorBoundary extends Component<{ children: ReactNode; onTraining: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="tk-screen">
        <p role="status" className="tk-note">Diese Seite lässt sich gerade nicht anzeigen. Deine Einträge sind nicht verloren.</p>
        <button type="button" onClick={() => { this.setState({ failed: false }); this.props.onTraining(); }}>Zum Training</button>
      </div>
    );
  }
}
