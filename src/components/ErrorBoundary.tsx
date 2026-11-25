import React from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected workspace runtime error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('FINGuard ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0D0F12] text-[#F1F4F8] flex items-center justify-center px-6">
          <div className="max-w-md w-full rounded-[24px] bg-[#14171D] border border-[#FFB020]/30 p-7 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-[#FFB020]/15 border border-[#FFB020]/40 text-[#FFB020] flex items-center justify-center mx-auto mb-4">
              <ShieldAlert size={22} />
            </div>
            <h2 className="text-lg font-semibold tracking-tight mb-2">Session Guard Triggered</h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed mb-5 break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FFB020] text-[#0D0F12] text-xs font-semibold hover:bg-[#FFC24D] transition-colors cursor-pointer"
            >
              <RotateCcw size={14} />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
