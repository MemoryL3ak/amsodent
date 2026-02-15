const MAP = {
  waiting: "badge badge-waiting",
  success: "badge badge-success",
  danger: "badge badge-danger",
  neutral: "badge badge-neutral",
};

export default function Badge({ children, tone = "neutral" }) {
  return <span className={MAP[tone] || MAP.neutral}>{children}</span>;
}
