export function Sidebar({ currentScope, setCurrentScope, companyNavItems, projectNavItems, page, setPage, currentProject, modelStatus, statusLine }) {
  const activeNav = currentScope === "project" ? projectNavItems : companyNavItems;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">PG</div>
        <div>
          <strong>ProjectGod</strong>
          <span>写作工作台</span>
        </div>
      </div>

      <div className="scope-switch">
        <button className={currentScope === "company" ? "active" : ""} onClick={() => setCurrentScope("company")}>
          公司层
        </button>
        <button className={currentScope === "project" ? "active" : ""} onClick={() => currentProject && setCurrentScope("project")} disabled={!currentProject}>
          书层
        </button>
      </div>

      {currentScope === "project" && (
        <div className="scope-card">
          <strong>{currentProject?.title || "未选中项目"}</strong>
          <span>{currentProject ? "该项目的资料、剧情与章节生产" : "先在公司层选择或创建项目"}</span>
        </div>
      )}

      <nav className="nav-list" aria-label="主导航">
        {activeNav.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => setPage(item.id)}
              title={`Alt+${index + 1}`}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="status-card">
        <span className={modelStatus?.configured && !modelStatus?.lastError ? "dot ok" : "dot warn"} />
        <div>
          <strong>{modelStatus?.configured ? (modelStatus?.lastError ? "模型暂不可用" : "模型已配置") : "离线模式"}</strong>
          <p>{modelStatus?.configured ? statusLine : "未检测到模型配置，写作按钮已禁用。"}</p>
        </div>
      </div>
    </aside>
  );
}

