const ids = new Set<string>();
export const markSwiped = (id: string) => ids.add(id);
export const filterSwiped = <T extends { id: string }>(arr: T[]): T[] => arr.filter(u => !ids.has(u.id));
