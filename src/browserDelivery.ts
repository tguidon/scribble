import { request } from "./api";
import type { FeedbackDelivery, DeliveryReceipt } from "./editorHost";

// Browser and embedded editors render the same delivery controls. Only the
// transport differs; capture, drawing, saving and feedback retrieval are shared.
export const browserDelivery: FeedbackDelivery = {
  canSend: true,
  async sendFeedback() {
    await request("/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  },
  deliveryStatus: () => request<DeliveryReceipt>("/delivery"),
};
