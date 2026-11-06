export interface UserLite { id: string; name: string; email: string; avatarUrl: string | null }

export interface Department {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parentId: string | null;
  managerId: string | null;
  sortOrder: number;
  memberCount: number;
  manager: UserLite | null;
}

export interface DepartmentMember extends UserLite {
  title: string | null;
  role: { key: string; name: string };
  employmentStatus: 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED';
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
}

export interface TreeNode extends Department { children: TreeNode[]; depth: number }

/** 평면 목록 → 트리 (고아 노드는 최상위로) */
export function buildTree(list: Department[]): TreeNode[] {
  const map = new Map<string, TreeNode>(list.map((d) => [d.id, { ...d, children: [], depth: 0 }]));
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (nodes: TreeNode[], depth: number) => nodes.forEach((n) => { n.depth = depth; setDepth(n.children, depth + 1); });
  setDepth(roots, 0);
  return roots;
}

/** 자기 자신과 모든 하위 부서 id (상위 부서 선택지에서 제외 — 순환 방지) */
export function descendantIds(list: Department[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of list) if (d.parentId && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); changed = true; }
  }
  return out;
}
