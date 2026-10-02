// An authored, explicitly labeled example UI. No external assets or network requests.
export async function exampleFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 820;
  const c = canvas.getContext("2d")!;
  const text = (
    value: string,
    x: number,
    y: number,
    size = 16,
    color = "#393c34",
    weight = 400,
  ) => {
    c.fillStyle = color;
    c.font = `${weight} ${size}px system-ui`;
    c.fillText(value, x, y);
  };
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    r = 0,
  ) => {
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
  };
  rect(0, 0, 1200, 820, "#fafbf8");
  rect(0, 0, 230, 820, "#f0f2eb");
  text("fieldnotes", 28, 52, 25, "#314234", 700);
  text("MY WORKSPACE", 28, 112, 11, "#657160", 600);
  rect(16, 134, 198, 43, "#dce5d5", 7);
  text("Overview", 34, 162, 15, "#314234", 600);
  ["Projects", "Reading list", "Notes", "Archive"].forEach((v, i) =>
    text(v, 34, 211 + i * 47, 15, "#657160"),
  );
  text("A little room to think.", 28, 775, 13, "#657160");
  text("Workspace / Overview", 277, 48, 13, "#747b6d");
  text("Thursday, October 1", 277, 107, 14, "#747b6d");
  text("Good ideas start here.", 277, 157, 36, "#314234", 600);
  text(
    "A home for your projects, notes, and everything in between.",
    277,
    192,
    16,
    "#747b6d",
  );
  rect(1006, 118, 142, 42, "#314234", 7);
  text("+ New project", 1026, 145, 14, "#ffffff", 500);
  text("On your mind", 277, 270, 19, "#314234", 600);
  text("View all", 1083, 270, 13, "#657160");
  const cards = [
    [
      "Website refresh",
      "A fresh start for our little corner of the internet.",
      "6 notes · Updated today",
    ],
    [
      "The reading room",
      "Good words worth coming back to.",
      "12 notes · Updated yesterday",
    ],
    [
      "Weekend ideas",
      "Small things to make, try, and explore.",
      "4 notes · Updated Monday",
    ],
  ];
  cards.forEach((card, i) => {
    const x = 277 + i * 297;
    rect(x, 294, 276, 227, "#ffffff", 9);
    rect(x + 20, 315, 38, 38, ["#e7ecd9", "#eee5d6", "#e2e9ef"][i], 8);
    text(["W", "R", "I"][i], x + 32, 340, 17, "#55624a", 600);
    text(card[0], x + 20, 387, 18, "#314234", 600);
    const words = card[1].split(" ");
    text(words.slice(0, 5).join(" "), x + 20, 421, 13, "#747b6d");
    text(words.slice(5).join(" "), x + 20, 441, 13, "#747b6d");
    text(card[2], x + 20, 492, 11, "#747b6d");
  });
  text("Recent notes", 277, 580, 19, "#314234", 600);
  [
    "What should the homepage say?",
    "A few references I keep coming back to",
    "Small changes, big difference",
  ].forEach((v, i) => {
    const y = 618 + i * 56;
    rect(277, y + 21, 870, 1, "#e6e9df");
    text(v, 288, y, 15, "#515b49");
    text(["Today", "Yesterday", "Sep 28"][i], 1052, y, 12, "#747b6d");
  });
  text("EXAMPLE WORKSPACE", 989, 794, 10, "#747b6d", 600);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return new File([blob], "Example — Fieldnotes.png", { type: "image/png" });
}
