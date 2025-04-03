"use client";

import dynamic from "next/dynamic";

const PageContent = dynamic(() => import('@/app/PageContent'), { ssr: false });

export default function PageContentWrapper() {
    return <PageContent />;
}
