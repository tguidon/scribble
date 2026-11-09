// Both harnesses submit the same instruction; screenshots stay out of the prompt.
export const feedbackMarker = (id) => `Scribble canvas: ${id}`;
export const feedbackMessage = (id) =>
  `Apply my Scribble feedback from canvas ${id}. Use Scribble's read_feedback tool with sessionId "${id}", then inspect every original image with read_image before making changes. Follow my feedback within this task's scope and verify the result.\n\n${feedbackMarker(id)}`;
