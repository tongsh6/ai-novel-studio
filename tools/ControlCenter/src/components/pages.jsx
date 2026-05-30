import { useEffect, useState } from "react";
import {
  Boxes,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Hammer,
  ListChecks,
  NotebookTabs,
  Play,
  RefreshCcw,
  ShieldCheck,
  SplitSquareHorizontal,
  Trash2,
  Users,
  Workflow
} from "lucide-react";
import { EmptyState, InfoColumns, Metric, SectionTitle } from "./shared.jsx";
import { boardConfig, chapterSteps, workflowSteps } from "../constants/ui.js";
import { api } from "../lib/api.js";
import { filesForGroups, statusLabel } from "../lib/view-models.js";

const companyGuideFiles = [
  "company/公司标准/工作台使用指南.md",
  "company/公司标准/命名规范.md",
  "company/公司标准/公司章程.md",
  "company/公司标准/情绪原则.md",
  "company/公司标准/评估规则.md",
  "company/共享方法/写作规则.md",
  "company/术语表/统一术语.md"
];
const actionVisuals = {
  "project-skeleton": { icon: NotebookTabs, tone: "company", hint: "创建资料树" },
  "core-selling-point": { icon: ShieldCheck, tone: "insight", hint: "压卖点与钩子" },
  "golden-three": { icon: Workflow, tone: "insight", hint: "排前三章节奏" },
  "character-card": { icon: Users, tone: "people", hint: "补角色卡" },
  "plotline-plan": { icon: SplitSquareHorizontal, tone: "plot", hint: "推进卷纲与篇章线" },
  "chapter-outline": { icon: ListChecks, tone: "plot", hint: "规划单章推进" },
  "chapter-contract": { icon: Hammer, tone: "build", hint: "生成施工图" },
  "scene-sequence": { icon: Workflow, tone: "build", hint: "拆场景序列" },
  "chapter-draft": { icon: FileText, tone: "build", hint: "生成正文草稿" },
  "payoff-audit": { icon: ClipboardCheck, tone: "review", hint: "查爽点与钩子" },
  "anti-ai-audit": { icon: ClipboardCheck, tone: "review", hint: "查语感与说明腔" },
  "foreshadow-check": { icon: ShieldCheck, tone: "review", hint: "查伏笔影响" },
  "timeline-check": { icon: ShieldCheck, tone: "review", hint: "查时间线矛盾" }
};

export function CompanyDashboard({ manifest, openFile, onDeleteFile, onRefreshLibrary, libraryRefreshing }) {
  const guideFiles = companyGuideFiles
    .map((targetPath) => manifest.files.find((file) => file.path === targetPath))
    .filter(Boolean);
  const companyLibraryFiles = manifest.files
    .filter((file) => file.path.startsWith("company/"))
    .sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));

  return (
    <section className="page-grid">
      <div className="metrics">
        <Metric icon={Boxes} label="部门" value={manifest.stats.departments} />
        <Metric icon={Workflow} label="按钮能力" value={manifest.stats.actions} />
        <Metric icon={NotebookTabs} label="小说项目" value={manifest.stats.projects} />
        <Metric icon={FileText} label="资料文件" value={manifest.files.length} />
      </div>
      <section className="panel wide">
        <SectionTitle icon={Workflow} title="你该怎么用这个工作台" subtitle="先在公司层看规则和入口，再进入具体小说，在书层完成资料维护、剧情推进和章节生产" />
        <div className="flow-row">
          {workflowSteps.map((step, index) => (
            <article key={step.title} className="flow-card read-only-card">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel wide">
        <SectionTitle icon={BookOpen} title="先读这些公司规则" subtitle="这些卡片就是整个网站的使用说明、命名规则、公司规则和写作底线；点开即可查看与修改" />
        <FileTiles files={guideFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
      <section className="panel wide">
        <SectionTitle icon={FileText} title="资料库" subtitle="company/ 下的资料文件会自动汇总成卡片；直接丢进目录里的文本文件，回到窗口后会自动刷新，也可手动刷新" />
        <div className="button-row inline-actions">
          <button className="ui-button secondary compact" onClick={() => onRefreshLibrary?.()} disabled={libraryRefreshing}>
            <RefreshCcw size={14} />
            {libraryRefreshing ? "正在刷新资料库" : "刷新资料库"}
          </button>
        </div>
        <FileTiles files={companyLibraryFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
      <section className="panel">
        <SectionTitle icon={ShieldCheck} title="公司层到底管什么" subtitle="这里不写某一本书的正文，只维护通用规则、部门能力、项目入口和共享方法" />
        <ul className="rule-list">
          <li>公司层提供统一命名规则、使用指南、情绪原则和评估规则。</li>
          <li>部门按钮执行前必须显式选择是对公司内容执行，还是对某一本书执行。</li>
          <li>公司层只做方法与规范，不混入某一本书的专属设定。</li>
          <li>所有结果先流式展示执行过程，确认后才写入目标文件。</li>
        </ul>
      </section>
      <section className="panel">
        <SectionTitle icon={ListChecks} title="网站使用底线" subtitle="这个网站不是文件浏览器，而是围绕写小说流程组织资料和动作" />
        <ul className="rule-list">
          <li>不开单独文件页兜底；资料必须落在所属工作台里被看见和操作。</li>
          <li>开新书只在公司层的“小说项目”页，不放到书层侧栏。</li>
          <li>进入某本书后，只看这本书的圣经、角色、剧情、章节工厂和连续性。</li>
          <li>资料卡可以直接打开、修改、删除，不需要再去找额外目录。</li>
        </ul>
      </section>
      <section className="panel">
        <SectionTitle icon={NotebookTabs} title="命名规则摘要" subtitle="所有新资料统一中文命名，目录和文件一眼能看懂" />
        <ul className="rule-list">
          <li>目录名统一中文：如“书籍圣经”“角色”“剧情”“伏笔”“时间”“正文”。</li>
          <li>文件名统一中文业务名：如“核心卖点.md”“剧情总纲.md”“章节_第一章_章节合同.md”。</li>
          <li>禁止再新建旧式平行目录；所有结果确认后直接写入目标文件。</li>
          <li>按钮生成的结果确认后，直接写到对应业务文件。</li>
        </ul>
      </section>
    </section>
  );
}

export function Departments({ manifest, selectedDepartment, setSelectedDepartment, currentProject, runAction, actionMap, actionsEnabled }) {
  const department = manifest.departments.find((item) => item.id === selectedDepartment) || manifest.departments[0];
  const [target, setTarget] = useState(currentProject ? currentProject.slug : "__company__");

  useEffect(() => {
    if (!currentProject && target !== "__company__") {
      setTarget("__company__");
    }
  }, [currentProject, target]);

  if (!department) {
    return <EmptyState message="当前没有部门资料。" />;
  }

  return (
    <section className="split-layout">
      <div className="left-list">
        {manifest.departments.map((item) => (
          <button key={item.id} className={item.id === department.id ? "active item-row" : "item-row"} onClick={() => setSelectedDepartment(item.id)}>
            <strong>{item.name}</strong>
            <span>{item.tagline}</span>
          </button>
        ))}
      </div>
      <div className="panel detail-panel">
        <SectionTitle icon={Boxes} title={department.name} subtitle={department.tagline} />
        <InfoColumns
          columns={[
            ["职责", department.responsibilities],
            ["能力", department.capabilities],
            ["输入资料", department.inputs],
            ["产出位置", department.outputs]
          ]}
        />
        <div className="scope-target">
          <label>
            <span>执行范围</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="__company__">公司级内容</option>
              {manifest.projects.map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ActionStrip
          actionIds={department.actions}
          actionMap={actionMap}
          disabled={!actionsEnabled}
          onRun={(id) => runAction(id, {}, { projectSlug: target === "__company__" ? "" : target })}
        />
      </div>
    </section>
  );
}

export function ProjectsHub({ manifest, selectedProject, openProject, onDeleteProject, builder, setBuilder, runAction, actionsEnabled }) {
  return (
    <section className="page-grid">
      <section className="panel wide">
        <SectionTitle icon={Workflow} title="开新书" subtitle="在公司层创建新项目；这里是唯一入口，不再放到书层侧栏里" />
        <div className="single-input">
          <label>
            <span>初始文本</span>
            <textarea
              value={builder.seed}
              onChange={(event) => setBuilder({ seed: event.target.value })}
              rows={14}
              placeholder="把题材、主角、爽点、卷纲、竞品感觉、禁区直接贴进来。"
            />
          </label>
        </div>
        <div className="button-row">
          <button className="ui-button primary large" disabled={!actionsEnabled || !builder.seed.trim()} onClick={() => runAction("project-skeleton", builder, { projectSlug: "" })}>
            <Play size={16} />
            创建书籍项目
          </button>
        </div>
      </section>

      <section className="panel wide">
        <SectionTitle icon={NotebookTabs} title="现有项目" subtitle="点进项目后，侧栏会切换成该书的二级目录" />
        {!manifest.projects.length ? (
          <EmptyState message="当前还没有书籍项目。" />
        ) : (
          <div className="project-grid">
            {manifest.projects.map((project) => (
              <article key={project.slug} className={project.slug === selectedProject ? "panel selected compact-panel" : "panel compact-panel"}>
                <div className="project-head">
                  <div>
                    <h2>{project.title}</h2>
                    <p>{project.currentTask}</p>
                  </div>
                  <div className="project-head-actions">
                    <button className="icon-button strong" onClick={() => openProject(project.slug)} title="进入项目">
                      <CheckCircle2 size={18} />
                    </button>
                    <button className="icon-button danger" onClick={() => onDeleteProject?.(project.slug, project.title)} title="删除书籍项目">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <ProjectHealth project={project} />
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export function ProjectOverview({ currentProject, manifest, openFile, onDeleteFile }) {
  if (!currentProject) {
    return <EmptyState message="未选中项目。" />;
  }

  const bibleFiles = filesForGroups(manifest.files, currentProject.slug, ["圣经", "世界"]);
  const characterFiles = filesForGroups(manifest.files, currentProject.slug, ["角色"]);
  const plotFiles = filesForGroups(manifest.files, currentProject.slug, ["剧情", "合同"]);
  const continuityFiles = filesForGroups(manifest.files, currentProject.slug, ["伏笔", "时间", "审稿"]);

  return (
    <section className="page-grid">
      <section className="panel wide">
        <SectionTitle icon={ShieldCheck} title={currentProject.title} subtitle="进入书层后，所有资料和执行动作都围绕当前书展开" />
        <ProjectHealth project={currentProject} />
      </section>
      <section className="panel">
        <SectionTitle icon={BookOpen} title="圣经与世界" subtitle="当前规则与世界资料入口" />
        <FileTiles files={bibleFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
      <section className="panel">
        <SectionTitle icon={Users} title="角色" subtitle="角色卡与关系资料" />
        <FileTiles files={characterFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
      <section className="panel">
        <SectionTitle icon={SplitSquareHorizontal} title="剧情" subtitle="卷纲、合同和场景序列" />
        <FileTiles files={plotFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
      <section className="panel">
        <SectionTitle icon={ClipboardCheck} title="连续性" subtitle="伏笔、时间线、审稿记录" />
        <FileTiles files={continuityFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
    </section>
  );
}

export function BoardPage({ boardKey, manifest, currentProject, runAction, actionMap, actionsEnabled, openFile, onDeleteFile }) {
  const board = boardConfig[boardKey];
  const relatedFiles = filesForGroups(manifest.files, currentProject?.slug, board.groups);
  const Icon = board.icon;

  return (
    <section className="page-grid">
      <section className="panel wide">
        <SectionTitle icon={Icon} title={board.title} subtitle={board.subtitle} />
        <ActionStrip
          actionIds={board.actions}
          actionMap={actionMap}
          disabled={!actionsEnabled || !currentProject}
          onRun={(id) => runAction(id, {}, { projectSlug: currentProject?.slug || "" })}
        />
      </section>
      <section className="panel wide">
        <SectionTitle icon={FileText} title="相关资料" subtitle="在当前工作台直接打开、查看和修改" />
        <FileTiles files={relatedFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
    </section>
  );
}

export function PlotBoard({ manifest, currentProject, runAction, actionMap, actionsEnabled, openFile, onDeleteFile }) {
  const plotFiles = filesForGroups(manifest.files, currentProject?.slug, ["剧情", "合同"]);
  const [plotCards, setPlotCards] = useState([]);
  const [plotLoading, setPlotLoading] = useState(false);
  const [plotError, setPlotError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!currentProject?.slug) {
      setPlotCards([]);
      setPlotError("");
      return;
    }
    setPlotLoading(true);
    setPlotError("");
    api(`/api/plot-cards?projectSlug=${encodeURIComponent(currentProject.slug)}`)
      .then((data) => {
        if (!cancelled) setPlotCards(data.cards || []);
      })
      .catch((error) => {
        if (!cancelled) {
          setPlotError(error.message);
          setPlotCards([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPlotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject?.slug]);

  return (
    <section className="page-grid">
      <section className="panel wide">
        <SectionTitle icon={SplitSquareHorizontal} title="剧情工作台" subtitle="剧情卡、合同和资料都在这里就地处理" />
        {plotLoading ? (
          <EmptyState message="正在读取剧情资料..." />
        ) : plotError ? (
          <EmptyState message={`剧情资料读取失败：${plotError}`} />
        ) : plotCards.length ? (
          <div className="corkboard">
            {plotCards.map((card, index) => (
              <button className="index-card clickable-card" key={card.key} onClick={() => openFile(card.path)}>
                <span>卡片 {String(index + 1).padStart(2, "0")}</span>
                <strong>{card.title}</strong>
                <p>{card.summary}</p>
                <small>{card.role}</small>
                <em>{statusLabel(card.status)}</em>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message="当前项目还没有剧情或合同资料。" />
        )}
        <ActionStrip
          actionIds={["plotline-plan", "golden-three"]}
          actionMap={actionMap}
          disabled={!actionsEnabled || !currentProject}
          onRun={(id) => runAction(id, {}, { projectSlug: currentProject?.slug || "" })}
        />
      </section>
      <section className="panel wide">
        <SectionTitle icon={FileText} title="剧情资料" subtitle="点击卡片直接查看或修改" />
        <FileTiles files={plotFiles} onOpenFile={openFile} onDeleteFile={onDeleteFile} />
      </section>
    </section>
  );
}

export function ChapterFactory({ currentProject, runAction, actionMap, actionsEnabled }) {
  const [chapterOptions, setChapterOptions] = useState([]);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [customChapterId, setCustomChapterId] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!currentProject?.slug) {
      setChapterOptions([]);
      setSelectedChapterId("");
      return;
    }
    setChapterLoading(true);
    api(`/api/chapter-options?projectSlug=${encodeURIComponent(currentProject.slug)}`)
      .then((data) => {
        if (cancelled) return;
        const chapters = data.chapters || [];
        setChapterOptions(chapters);
        setSelectedChapterId((prev) => {
          if (prev && chapters.some((item) => item.id === prev)) return prev;
          return chapters[0]?.id || "";
        });
      })
      .catch(() => {
        if (!cancelled) {
          setChapterOptions([]);
          setSelectedChapterId("");
        }
      })
      .finally(() => {
        if (!cancelled) setChapterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject?.slug]);

  const activeChapterId = (customChapterId.trim() || selectedChapterId).trim();
  const activeChapterLabel = activeChapterId || "当前章节";

  return (
    <section className="panel">
      <SectionTitle icon={Hammer} title="章节工厂" subtitle={`${currentProject?.title || "当前项目"} · 先选章节，再按流水线生产`} />
      {!currentProject ? (
        <EmptyState message="还没有选中项目，无法生成章节合同或草稿。" />
      ) : (
        <>
          <div className="factory-toolbar">
            <label className="factory-chapter-field">
              <span>已有章节</span>
              <select
                value={selectedChapterId}
                disabled={chapterLoading || Boolean(customChapterId.trim())}
                onChange={(event) => {
                  setCustomChapterId("");
                  setSelectedChapterId(event.target.value);
                }}
              >
                <option value="">{chapterLoading ? "正在读取章节..." : chapterOptions.length ? "选择已有章节" : "暂无已有章节"}</option>
                {chapterOptions.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="factory-chapter-field grow">
              <span>或新建章节标识</span>
              <input
                type="text"
                value={customChapterId}
                placeholder="例如：第一章 / 第1章"
                onChange={(event) => setCustomChapterId(event.target.value)}
              />
            </label>
            {activeChapterId ? (
              <div className="factory-chapter-active">
                <span>当前生产章节</span>
                <strong>{activeChapterLabel}</strong>
              </div>
            ) : (
              <div className="factory-chapter-active muted">
                <span>请先选择或输入章节标识</span>
              </div>
            )}
          </div>
          <div className="factory-lane">
            {chapterSteps.map((step, index) => {
              const action = actionMap.get(step.action);
              return (
                <button
                  key={step.id}
                  className="factory-step"
                  disabled={!actionsEnabled || !activeChapterId}
                  onClick={() => runAction(step.action, {
                    chapterId: activeChapterId,
                    chapterLabel: activeChapterLabel,
                    projectSlug: currentProject.slug
                  }, { projectSlug: currentProject.slug })}
                >
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                  <p>{step.note}</p>
                  <em>{action?.label}</em>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function ProjectHealth({ project }) {
  if (!project) {
    return <EmptyState message="暂无项目。" />;
  }

  const readyLibrary = (project.library || []).filter((item) => item.ready);
  const missingLibrary = (project.library || []).filter((item) => !item.ready).map((item) => item.name);

  return (
    <div className="health">
      <div className="health-metrics">
        <div className="health-metric-card">
          <span>已就绪资料区</span>
          <strong>{readyLibrary.length}/{project.library?.length || 0}</strong>
        </div>
        <div className="health-metric-card">
          <span>资料文件数</span>
          <strong>{project.fileCount}</strong>
        </div>
        <div className="health-metric-card">
          <span>当前阶段</span>
          <strong>{project.stage}</strong>
        </div>
      </div>
      <p>{project.currentTask}</p>
      {missingLibrary.length > 0 ? (
        <div className="health-missing">
          <span>还缺这些资料区</span>
          <div className="mini-chip-list">
            {missingLibrary.map((item) => <em key={item}>{item}</em>)}
          </div>
        </div>
      ) : (
        <div className="health-missing ready">
          <span>资料区已齐，可以直接推进剧情、章节与连续性工作。</span>
        </div>
      )}
    </div>
  );
}

function ActionStrip({ actionIds, actionMap, disabled, onRun }) {
  return (
    <div className="action-strip">
      {actionIds.map((id) => {
        const action = actionMap.get(id);
        if (!action) return null;
        const visual = actionVisuals[id] || {};
        const Icon = visual.icon || Play;
        return (
          <button key={id} className={`action-button ${visual.tone || "default"}`} disabled={disabled} onClick={() => onRun(id)}>
            <span className="action-button-icon">
              <Icon size={16} />
            </span>
            <span className="action-button-copy">
              <strong>{action.label}</strong>
              <small>{visual.hint || action.stage}</small>
            </span>
            <em>{action.stage}</em>
          </button>
        );
      })}
    </div>
  );
}

function FileTiles({ files, onOpenFile, onDeleteFile }) {
  if (!files.length) {
    return <EmptyState message="当前区域还没有对应资料。" />;
  }

  return (
    <div className="file-tiles">
      {files.map((file) => (
        <article className="file-tile clickable-card" key={file.path}>
          <button className="file-tile-open" onClick={() => onOpenFile(file.path)}>
            <FileText size={17} />
            <strong>{file.name}</strong>
            <span>{file.path}</span>
            <em>{statusLabel(file.status)}</em>
          </button>
          <button className="file-tile-delete" title="删除文件" onClick={() => onDeleteFile?.(file.path)}>
            <Trash2 size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}
