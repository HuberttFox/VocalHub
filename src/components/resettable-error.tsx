"use client";

import { ErrorState } from "@/components/empty-state";

export function ResettableError({ title, reset }: { title: string; reset: () => void }) {
  return <ErrorState code="500" title={title} description="本地数据库暂时无法完成请求，请稍后重试。" action={<button className="button-primary" onClick={reset} type="button">重试</button>} />;
}
