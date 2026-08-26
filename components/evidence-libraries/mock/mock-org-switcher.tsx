"use client";

import { Check, ChevronDown, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MOCK_ORGANIZATIONS } from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { OrgAvatar } from "./org-avatar";

/** Fake organisation menu. Stands in for the Clerk switcher in the prototype. */
export function MockOrgSwitcher() {
  const t = useTranslations("evidenceLibraryMock");
  const router = useRouter();
  const org = useEvidenceLibraryMockStore(selectOrganization);
  const switchOrganization = useEvidenceLibraryMockStore(
    (s) => s.switchOrganization,
  );

  function choose(orgId: string) {
    if (orgId === org.id) return;
    switchOrganization(orgId);
    const next = MOCK_ORGANIZATIONS.find((o) => o.id === orgId);
    toast(t("switchedOrganization"), { description: next?.name });
    router.push("/evidence-libraries");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" data-mock-org={org.id}>
          <OrgAvatar initials={org.initials} color={org.color} className="size-5 text-[9px]" />
          <span className="max-w-[180px] truncate">{org.name}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("organizationLabel")}</DropdownMenuLabel>
        {MOCK_ORGANIZATIONS.map((o) => (
          <DropdownMenuItem
            key={o.id}
            role="menuitemradio"
            aria-checked={o.id === org.id}
            onSelect={() => choose(o.id)}
          >
            <OrgAvatar initials={o.initials} color={o.color} className="size-5 text-[9px]" />
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === org.id ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
