import React from "react";

interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
        <span className="text-5xl">⚠️</span>
        <h2 className="text-lg font-bold text-gray-800">เกิดข้อผิดพลาด</h2>
        <p className="text-sm text-gray-500 max-w-md">
          {this.state.error?.message ?? "Unknown error"}
        </p>
        <button
          onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          รีเฟรชหน้า
        </button>
      </div>
    );
  }
}
