'use client';

import Image from 'next/image';
import Link from 'next/link';

type BrandLogoProps = {
  /** When true (default), wraps the image in a link to `/app`. */
  withLink?: boolean;
  className?: string;
  imageClassName?: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

export function BrandLogo({
  withLink = true,
  className = '',
  imageClassName = 'h-9 w-auto max-w-[200px]',
  width = 200,
  height = 48,
  priority = false,
}: BrandLogoProps) {
  const img = (
    <Image
      src="/ARC.png"
      alt="ARC"
      width={width}
      height={height}
      className={imageClassName}
      priority={priority}
      sizes="(max-width: 240px) 100vw, 200px"
    />
  );
  if (withLink) {
    return (
      <Link href="/app" className={`inline-flex items-center ${className}`}>
        {img}
      </Link>
    );
  }
  return <span className={`inline-flex items-center justify-center ${className}`}>{img}</span>;
}
