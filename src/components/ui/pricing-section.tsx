import { useRef } from "react";
import NumberFlow from "@number-flow/react";
import { BarChart3, Calculator, CheckCheck, Gauge, Radar, Ticket } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Every plan unlocks the whole app — the only difference is how long for and
// how much you save by committing to a longer period.
const includedFeatures = [
  { text: "Cover-bet Calculator", icon: Calculator },
  { text: "Live odds Scanner", icon: Radar },
  { text: "Edge finder", icon: Gauge },
  { text: "Bet tracking & My Bets", icon: Ticket },
  { text: "Profit & loss Stats", icon: BarChart3 },
];

const revealVariants = {
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { delay: i * 0.25, duration: 0.5 },
  }),
  hidden: { filter: "blur(10px)", y: -20, opacity: 0 },
};

interface PricingSectionProps {
  onSelectPlan: (plan: SubscriptionPlan) => void;
  /** The plan whose selection is currently being saved, if any. */
  busyPlan?: SubscriptionPlan | null;
  /** The plan the user has already picked, highlighted as selected. */
  selectedPlan?: SubscriptionPlan | null;
}

export default function PricingSection({
  onSelectPlan,
  busyPlan = null,
  selectedPlan = null,
}: PricingSectionProps) {
  const pricingRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative mx-auto min-h-screen w-full px-4 py-16" ref={pricingRef}>
      <div className="mx-auto mb-10 max-w-3xl text-center">
        <TimelineContent
          as="h2"
          animationNum={0}
          timelineRef={pricingRef}
          customVariants={revealVariants}
          className="font-display text-3xl font-bold text-foreground sm:text-4xl md:text-5xl"
        >
          Choose your{" "}
          <TimelineContent
            as="span"
            animationNum={1}
            timelineRef={pricingRef}
            customVariants={revealVariants}
            className="inline-block rounded-xl border border-dashed border-primary bg-sky-soft px-2 py-1 text-primary"
          >
            OctoOdds
          </TimelineContent>{" "}
          plan
        </TimelineContent>

        <TimelineContent
          as="p"
          animationNum={2}
          timelineRef={pricingRef}
          customVariants={revealVariants}
          className="mx-auto mt-4 w-[85%] text-sm text-muted-foreground sm:text-base"
        >
          Every plan unlocks the full calculator, scanner and bet tracker. Commit longer to save
          more. Access opens as soon as your payment is confirmed.
        </TimelineContent>
      </div>

      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan, index) => {
          const perMonth = plan.price / plan.months;
          const isSelected = selectedPlan === plan.id;
          const isBusy = busyPlan === plan.id;
          return (
            <TimelineContent
              key={plan.id}
              as="div"
              animationNum={3 + index}
              timelineRef={pricingRef}
              customVariants={revealVariants}
            >
              <Card
                className={cn(
                  "relative h-full border-border",
                  plan.popular ? "bg-sky-soft ring-2 ring-primary" : "bg-card",
                )}
              >
                <CardHeader className="text-left">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-2xl font-bold text-foreground">{plan.name}</h3>
                    {plan.popular && (
                      <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        Best value
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-baseline">
                    <span className="font-display text-4xl font-bold text-foreground">
                      $<NumberFlow value={plan.price} className="font-display text-4xl font-bold" />
                    </span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      /{plan.months === 1 ? "month" : `${plan.months} months`}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan.savings > 0
                      ? `That's $${perMonth.toFixed(2)}/mo — save $${plan.savings}`
                      : "Billed monthly"}
                  </p>
                </CardHeader>

                <CardContent className="pt-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onSelectPlan(plan.id)}
                    className={cn(
                      "mb-6 w-full rounded-xl p-3 text-base font-semibold transition-colors disabled:opacity-60",
                      plan.popular
                        ? "bg-primary text-primary-foreground shadow-lift hover:bg-primary/90"
                        : "border border-border bg-foreground text-background hover:bg-foreground/90",
                    )}
                  >
                    {isBusy ? "Saving…" : isSelected ? "Selected — change" : "Choose plan"}
                  </button>

                  <ul className="space-y-2 border-t border-border pt-4">
                    {includedFeatures.map((feature) => (
                      <li key={feature.text} className="flex items-center">
                        <span className="mr-3 grid size-6 place-content-center rounded-full border border-primary bg-success/10">
                          <CheckCheck className="size-3.5 text-primary" />
                        </span>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <feature.icon className="size-4" /> {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TimelineContent>
          );
        })}
      </div>
    </div>
  );
}
