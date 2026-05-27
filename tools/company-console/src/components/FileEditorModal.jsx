import { Eye, Pencil, Save, Trash2, X } from "lucide-react";
import { renderMarkdown } from "../lib/markdown.js";

export function FileEditorModal({ editor, onClose, onChange, onSave, onDelete }) {
  if (!editor) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal editor-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{editor.mode === "edit" ? "编辑文件" : "查看文件"}</p>
            <h2>{editor.path}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="editor-toolbar">
          <button className={editor.mode === "preview" ? "active" : ""} onClick={() => onChange({ mode: "preview" })}>
            <Eye size={15} />
            预览
          </button>
          <button className={editor.mode === "edit" ? "active" : ""} onClick={() => onChange({ mode: "edit" })}>
            <Pencil size={15} />
            编辑
          </button>
        </div>
        <div className="editor-body">
          {editor.mode === "edit" ? (
            <textarea
              value={editor.draft}
              onChange={(event) => onChange({ draft: event.target.value })}
              rows={24}
            />
          ) : (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(editor.draft || "") }} />
          )}
        </div>
        <div className="modal-actions">
          <span>{editor.dirty ? "有未保存修改" : "当前内容与磁盘一致"}</span>
          <div className="button-row">
            <button className="danger" onClick={() => onDelete?.(editor.path)}>
              <Trash2 size={15} />
              删除文件
            </button>
            <button onClick={onClose}>关闭</button>
            <button className="primary" disabled={!editor.dirty || editor.saving} onClick={onSave}>
              <Save size={15} />
              {editor.saving ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
