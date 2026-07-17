"use client";
import { PageContainer } from "@/components/page-container";
import { ResettableError } from "@/components/resettable-error";
export default function SongsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main id="main-content"><PageContainer className="py-20"><ResettableError title="无法加载歌曲目录" reset={reset} /></PageContainer></main>; }
