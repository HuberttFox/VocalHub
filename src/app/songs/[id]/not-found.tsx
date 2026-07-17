import Link from "next/link";
import { ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
export default function SongNotFound() { return <main id="main-content"><PageContainer className="py-20"><ErrorState code="404" title="没有找到这首歌曲" description="歌曲可能不存在、尚未完成同步，或已从公开目录移除。" action={<Link className="button-secondary" href="/songs">返回歌曲目录</Link>} /></PageContainer></main>; }
