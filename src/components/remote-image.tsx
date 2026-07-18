"use client";

import { useState } from "react";

type RemoteImageProps = {
  src: string | null | Array<string | null>;
  alt: string;
  width: number;
  height: number;
  className?: string;
  fallbackLabel?: string;
  eager?: boolean;
  fallbackIcon?: "music" | "video";
};

export function RemoteImage({
  src,
  alt,
  width,
  height,
  className,
  fallbackLabel = "图片不可用",
  eager = false,
  fallbackIcon = "music",
}: RemoteImageProps) {
  const sources = (Array.isArray(src) ? src : [src]).filter(
    (value): value is string => Boolean(value),
  );
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const currentSrc = sources.find((source) => !failedSources.includes(source));
  const unavailable = !currentSrc;

  if (unavailable) {
    return (
      <div
        className={`remote-image-fallback ${className ?? ""}`}
        role={alt ? "img" : undefined}
        aria-label={alt ? fallbackLabel : undefined}
        aria-hidden={alt ? undefined : "true"}
      >
        <span aria-hidden="true">{fallbackIcon === "video" ? "▶" : "♪"}</span>
        {alt && <span className="sr-only">{fallbackLabel}</span>}
      </div>
    );
  }

  return (
    // Remote hosts are dynamic source data; direct loading avoids a wildcard server-side image proxy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={className}
      decoding="async"
      height={height}
      loading={eager ? "eager" : "lazy"}
      onError={() =>
        setFailedSources((failed) =>
          failed.includes(currentSrc) ? failed : [...failed, currentSrc],
        )
      }
      referrerPolicy="no-referrer"
      src={currentSrc}
      width={width}
    />
  );
}
