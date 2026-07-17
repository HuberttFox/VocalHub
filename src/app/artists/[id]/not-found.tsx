import Link from "next/link";
import { ErrorState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
export default function ArtistNotFound() { return <main id="main-content"><PageContainer className="py-20"><ErrorState code="404" title="没有找到这位作者" description="作者可能不存在、没有公开关联作品，或同步快照不可用。" action={<Link className="button-secondary" href="/songs">返回歌曲目录</Link>} /></PageContainer></main>; }
