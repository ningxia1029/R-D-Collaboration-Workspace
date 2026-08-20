type StatusDelegate = {
  updateMany(args: {
    where: { id: string; status: string };
    data: { status: string };
  }): Promise<{ count: number }>;
};

/** 带旧状态条件的 CAS；并发请求只有一个能够成功认领状态。 */
export async function compareAndSetStatus(
  delegate: StatusDelegate,
  id: string,
  from: string,
  to: string,
): Promise<boolean> {
  const result = await delegate.updateMany({ where: { id, status: from }, data: { status: to } });
  return result.count === 1;
}
