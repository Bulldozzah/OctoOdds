import { useMemo, type ReactNode, type RefObject } from "react";
import { motion, useInView, type Variants } from "motion/react";

type TimelineTag = "div" | "span" | "p" | "h1" | "h2" | "h3" | "h4" | "li" | "ul" | "section";

const motionByTag = {
  div: motion.div,
  span: motion.span,
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  li: motion.li,
  ul: motion.ul,
  section: motion.section,
} as const;

interface TimelineContentProps {
  children?: ReactNode;
  /** Which HTML element to render. Defaults to a div. */
  as?: TimelineTag;
  /** Stagger index — later elements reveal after earlier ones. */
  animationNum: number;
  /** The scroll container whose visibility drives the reveal. */
  timelineRef: RefObject<HTMLElement | null>;
  customVariants?: Variants;
  /** Animate only the first time it enters the viewport. */
  once?: boolean;
  className?: string;
}

const defaultVariants: Variants = {
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { delay: i * 0.1, duration: 0.5 },
  }),
  hidden: { filter: "blur(10px)", y: -20, opacity: 0 },
};

/**
 * Reveals its children with a staggered blur-up as the referenced element
 * scrolls into view. Adapted from the shadcn "timeline animation" primitive.
 */
export function TimelineContent({
  children,
  as = "div",
  animationNum,
  timelineRef,
  customVariants,
  once = false,
  ...rest
}: TimelineContentProps) {
  const MotionTag = useMemo(() => motionByTag[as] ?? motion.div, [as]);
  const isInView = useInView(timelineRef, { once });
  const variants = customVariants ?? defaultVariants;

  return (
    <MotionTag
      custom={animationNum}
      variants={variants}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
