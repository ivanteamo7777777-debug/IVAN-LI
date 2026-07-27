import type { Metadata } from "next";
import { TodayView } from "@/components/today/today-view";

export const metadata: Metadata = { title: "今日执行" };

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return <TodayView initialDate={date} />;
}
