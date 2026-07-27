import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = { title: "设置与数据" };

export default function SettingsPage() {
  return <SettingsView />;
}
