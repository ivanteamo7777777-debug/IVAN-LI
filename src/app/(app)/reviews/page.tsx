import type { Metadata } from "next";
import { ReviewsView } from "@/components/reviews-view";

export const metadata: Metadata = { title: "复盘库" };

export default function ReviewsPage() {
  return <ReviewsView />;
}
