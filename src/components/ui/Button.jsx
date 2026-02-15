export default function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}) {
  const variants = {
    primary: "btn btn-primary",
    secondary: "btn btn-secondary",
    danger: "btn btn-danger",
    ghost: "btn btn-ghost",
  };

  const sizes = {
    sm: "btn-sm",
    md: "btn-md",
    lg: "btn-lg",
  };

  const cls = `${variants[variant] || variants.primary} ${
    sizes[size] || sizes.md
  }`;

  return (
    <button type={type} className={cls} {...props}>
      {children}
    </button>
  );
}
