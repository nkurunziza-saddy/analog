// UI primitives ported from block (products/block/apps/web/src/components): same names, same values.
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Join class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- button

export type ButtonVariant = "primary" | "accent" | "secondary" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const base = cn(
  "group/btn relative inline-flex shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center whitespace-nowrap rounded-full font-medium leading-none tracking-tight",
  "transition-[scale,background-color,color,box-shadow,opacity] duration-200 ease-(--ease-out) active:scale-[0.97] active:duration-100",
  "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none motion-reduce:transition-none motion-reduce:active:scale-100",
);

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-cta text-cta-fg bg-[linear-gradient(to_bottom,rgb(255_255_255/0.14),rgb(255_255_255/0)_60%)]",
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.16),0_2px_6px_-2px_rgb(0_0_0/0.2)]",
    "hover:bg-cta/90 active:shadow-[0_0_1px_rgb(0_0_0/0.16)]",
    "dark:bg-[linear-gradient(to_bottom,rgb(255_255_255/0),rgb(0_0_0/0.06)_60%)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.3)]",
  ),
  accent: cn(
    "bg-accent text-accent-fg bg-[linear-gradient(to_bottom,rgb(255_255_255/0.16),rgb(255_255_255/0)_60%)]",
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.16),0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]",
    "hover:brightness-105 active:shadow-none",
  ),
  secondary: "bg-surface-2 text-fg hover:bg-surface-3 active:bg-surface-3",
  outline: cn(
    "bg-raised text-fg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--fg)_13%,transparent),0_1px_2px_rgb(0_0_0/0.05)]",
    "hover:bg-surface hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--fg)_18%,transparent),0_2px_5px_-1px_rgb(0_0_0/0.08)]",
  ),
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg active:bg-surface-3",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3.5 text-[13px] [&_svg]:size-3.5",
  md: "h-10 gap-2 px-4 text-[14px] [&_svg]:size-4",
  lg: "h-12 gap-2 px-5 text-[15px] [&_svg]:size-[18px]",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  full = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], full && "w-full", className)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-[inherit] transition-[opacity,filter,scale] duration-150",
          loading && "scale-90 opacity-0 blur-[2px]",
        )}
      >
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <Spinner />
        </span>
      )}
    </button>
  );
}

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={cn("size-4 animate-spin-slow", className)}
    >
      <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------- sections

/**
 * A heading as two lines at one size: the title in ink, the subtitle muted beneath it.
 * No eyebrows or labels above it.
 */
export function Heading({
  title,
  subtitle,
  size = "section",
  action,
  as: Tag = size === "hero" ? "h1" : size === "page" ? "h1" : "h2",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  size?: "hero" | "page" | "section";
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  const type = {
    hero: "text-[30px] leading-[1.15] tracking-(--tracking-tighter) md:text-[38px]",
    page: "text-[26px] leading-[1.25] tracking-(--tracking-tighter)",
    section: "text-[17px] leading-[1.35] tracking-tight",
  }[size];
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", size === "section" && "mb-3 px-1")}>
      <Tag className={cn("min-w-0", size !== "section" && "text-balance", type)}>
        <span className="block font-medium text-fg">{title}</span>
        {subtitle && <span className="block font-normal text-fg-muted">{subtitle}</span>}
      </Tag>
      {action}
    </div>
  );
}

/** A section heading over a card. */
export function SectionTitle({ children, subtitle, action }: { children: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return <Heading title={children} subtitle={subtitle} action={action} />;
}

/** A raised surface inside a soft tinted frame. */
export function Card({
  children,
  className,
  surfaceClassName,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  surfaceClassName?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn("rounded-[20px] bg-surface p-1", className)}>
      <div className={cn("rounded-2xl bg-raised shadow-card", padded && "p-4", surfaceClassName)}>{children}</div>
    </div>
  );
}

/** What a section says when there is nothing in it yet, and the way to change that. */
export function Empty({ icon, title, children }: { icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[20px] bg-surface px-6 py-10 text-center">
      {icon && (
        <span className="mb-4 grid size-11 place-items-center rounded-2xl bg-raised text-fg-muted shadow-card [&_svg]:size-5">
          {icon}
        </span>
      )}
      {title && <p className="text-[15px] font-medium">{title}</p>}
      <p className={cn("max-w-[38ch] text-sm text-pretty text-fg-muted", title && "mt-1")}>{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------- small parts

export type Tone = "neutral" | "accent" | "positive" | "negative" | "subtle";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  accent: "bg-accent/12 text-accent",
  positive: "bg-positive/12 text-positive",
  negative: "bg-negative/12 text-negative",
  subtle: "bg-surface-2 text-fg-subtle",
};

/** A status pill; `live` adds a pulsing dot. */
export function Pill({
  tone = "neutral",
  live,
  dot,
  children,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {(live || dot) && <span className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse")} aria-hidden />}
      {children}
    </span>
  );
}

/** A pill-shaped segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="flex gap-0.5 rounded-full bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 font-medium transition-[background-color,color,box-shadow] duration-150",
              size === "md" ? "h-9 text-sm" : "h-7 text-[13px]",
              active ? "bg-raised text-fg shadow-raised" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label/value rows. */
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("divide-y divide-line rounded-2xl bg-surface px-4 text-sm", className)}>{children}</dl>;
}

export function Detail({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-3 truncate", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

/** A form field: label on top, a rounded well. */
export const fieldClass =
  "h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] text-fg outline-none transition-[background-color,box-shadow] duration-150 focus:bg-raised focus:shadow-[inset_0_0_0_1.5px_var(--accent)] disabled:opacity-50";

// ---------------------------------------------------------------- marks and icons (inline, 24px grid, currentColor)

/** The mark: a rounded block carrying a wave, the stream's rate. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="6.5" className="fill-accent" />
      <path
        d="M5 14.5c2.2 0 2.6-5 5-5s2.8 5 5 5 2.4-3 4-3"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        className="stroke-bg dark:stroke-[#0a0b0d]"
      />
    </svg>
  );
}

/** Filled glyphs on a 24px grid, in currentColor. Cut-outs use the even-odd rule. */
function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden className={cn("size-4 shrink-0", className)}>
      <path d={d} />
    </svg>
  );
}

type IconProps = { className?: string };
export const IconExternal = (p: IconProps) => (
  <Icon {...p} d="M14 3h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V6.4l-7.3 7.3a1 1 0 0 1-1.4-1.4L17.6 5H14a1 1 0 1 1 0-2ZM5 6h5a1 1 0 1 1 0 2H5v11h11v-5a1 1 0 1 1 2 0v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
);
export const IconWallet = (p: IconProps) => (
  <Icon {...p} d="M5 4h11a2 2 0 0 1 2 2v1H5.5a1 1 0 0 0 0 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm11.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
);
export const IconPulse = (p: IconProps) => <Icon {...p} d="M13.5 2 4 14h7l-1.5 8L19 10h-7l1.5-8Z" />;
export const IconFlask = (p: IconProps) => (
  <Icon {...p} d="M9 2h6a1 1 0 1 1 0 2v5.2l4.9 8.5A2.2 2.2 0 0 1 18 21H6a2.2 2.2 0 0 1-1.9-3.3L9 9.2V4a1 1 0 0 1 0-2Z" />
);
export const IconPlay = (p: IconProps) => (
  <Icon {...p} d="M7 4.6v14.8a1 1 0 0 0 1.5.85l11.9-7.4a1 1 0 0 0 0-1.7L8.5 3.75A1 1 0 0 0 7 4.6Z" />
);
export const IconStop = (p: IconProps) => <Icon {...p} d="M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6Z" />;
export const IconPlus = (p: IconProps) => (
  <Icon {...p} d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 6v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H8a1 1 0 1 1 0-2h3V8a1 1 0 1 1 2 0Z" />
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p} d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7-5.5 5.5a1 1 0 0 1-1.4 0l-2.5-2.5a1 1 0 1 1 1.4-1.4l1.8 1.8 4.8-4.8a1 1 0 1 1 1.4 1.4Z" />
);
export const IconX = (p: IconProps) => (
  <Icon {...p} d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.7 12.3a1 1 0 0 1-1.4 1.4L12 13.4l-2.3 2.3a1 1 0 0 1-1.4-1.4l2.3-2.3-2.3-2.3a1 1 0 0 1 1.4-1.4l2.3 2.3 2.3-2.3a1 1 0 0 1 1.4 1.4L13.4 12Z" />
);
export const IconMinus = (p: IconProps) => <Icon {...p} d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 11H8a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2Z" />;
