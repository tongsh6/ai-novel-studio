export function statusLabel(status) {
  return {
    book: "书籍资料",
    company: "公司资料",
    reference: "参考",
    loading: "加载中"
  }[status] || "参考";
}

export function groupFiles(files) {
  return files.reduce((acc, file) => {
    const key = file.area === "company" ? "company" : file.area === "book" ? "project" : "root";
    acc[key] ||= [];
    acc[key].push(file);
    return acc;
  }, {});
}

export function groupLabel(groupKey) {
  return {
    company: "公司资料",
    project: "小说项目",
    root: "根目录"
  }[groupKey] || groupKey;
}

export function filesForGroups(files, slug, groups) {
  if (!slug) return [];
  return files.filter((file) => file.path.startsWith(`books/${slug}/`) && groups.some((group) => file.path.includes(`/${group}/`)));
}

export function breadcrumbParts(filePath) {
  return String(filePath || "")
    .split("/")
    .filter(Boolean)
    .map((segment, index, list) => ({
      label: segment,
      key: `${index}-${segment}`,
      isLast: index === list.length - 1
    }));
}

export function buildPlotCards(files) {
  return files.map((file) => {
    const folder = file.path.split("/").at(-2) || "";
    const role = folder === "剧情"
      ? "卷纲与篇章线"
      : folder === "合同"
        ? "章节合同与场景序列"
        : "剧情资料";
    return {
      key: file.path,
      title: prettifyFileName(file.name),
      role,
      path: file.path,
      status: statusLabel(file.status)
    };
  });
}

export function modelStatusLine(status) {
  const model = status?.model ? `模型 ${status.model} · ` : "";
  if (status?.lastError) {
    return status.retryAfter ? `${model}配额限制，重试时间 ${new Date(status.retryAfter).toLocaleString()}` : `${model}最近一次模型调用失败`;
  }
  return `${model}按钮会调用配置模型`;
}

function prettifyFileName(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\bv(\d+)\b/gi, "v$1")
    .trim();
}
