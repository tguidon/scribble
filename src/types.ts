export type Point = { x: number; y: number };
export type Tool =
  "select" | "pin" | "arrow" | "rectangle" | "freehand" | "pan";
export type Annotation = {
  id: string;
  type: Exclude<Tool, "select" | "pan">;
  color: string;
  points: Point[];
  comment: string;
};
export type Screenshot = {
  id: string;
  name: string;
  width: number;
  height: number;
  file: string;
  mime: string;
  annotations: Annotation[];
};
export type Session = {
  id: string;
  title: string;
  status: "draft" | "submitted";
  message: string;
  images: Screenshot[];
  revision: number;
  updatedAt: string;
  submittedAt?: string;
  bundlePath?: string;
};
export type Draft = Pick<Session, "message" | "images">;
export const INKS = [
  { name: "Coral", color: "#c94b35" },
  { name: "Blue", color: "#3559c7" },
  { name: "Green", color: "#267052" },
  { name: "Purple", color: "#8753af" },
];
