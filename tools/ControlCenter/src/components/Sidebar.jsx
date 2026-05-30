export function Sidebar({ currentScope, setCurrentScope, companyNavItems, projectNavItems, page, setPage, currentProject, projects, onSelectProject, modelStatus, statusLine }) {
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
        <button className={currentScope === "company" ? "active ui-button secondary" : "ui-button secondary"} onClick={() => setCurrentScope("company")}>
          公司层
        </button>
        <button className={currentScope === "project" ? "active ui-button secondary" : "ui-button secondary"} onClick={() => currentProject && setCurrentScope("project")} disabled={!currentProject}>
          书层
        </button>
      </div>

      {currentScope === "project" && (
        <div className="scope-card">
          <strong>当前书籍</strong>
          <span>{currentProject ? "点下面的书籍按钮直接切换，不再只是静态展示标题。" : "先在公司层选择或创建项目"}</span>
          <div className="project-switch-list">
            {(projects || []).map((project) => (
              <button
                key={project.slug}
                className={project.slug === currentProject?.slug ? "project-switch-button active" : "project-switch-button"}
                onClick={() => onSelectProject?.(project.slug)}
              >
                <strong>{project.title}</strong>
                <em>{project.fileCount} 个资料文件</em>
              </button>
            ))}
          </div>
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
