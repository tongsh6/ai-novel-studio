import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "界面渲染失败" };
  }

  componentDidCatch(error) {
    console.error("ControlCenter render error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-error">
          <h1>界面渲染失败</h1>
          <p>{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

