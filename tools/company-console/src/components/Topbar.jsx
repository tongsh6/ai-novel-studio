export function Topbar({ manifest, currentScope, currentProject, onBackToCompany }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{currentScope === "project" ? "书籍工作区" : "公司工作台"}</p>
        <h1>{currentScope === "project" ? (currentProject?.title || "未选中项目") : "ProjectGod 公司工作台"}</h1>
      </div>
      <div className="topbar-actions">
        {currentScope === "project" && (
          <button onClick={onBackToCompany}>返回公司层</button>
        )}
        <span className="pill library">书籍资料 {manifest.stats.bookFiles}</span>
        <span className="pill company">公司资料 {manifest.stats.companyFiles}</span>
      </div>
    </header>
  );
}
