export default function Page() {
  return (
    <div className="flex flex-col gap-6 text-center">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Thank you for signing up!
        </h2>
        <p className="text-sm text-muted-foreground">Check your email to confirm</p>
      </div>
      <p className="text-sm text-muted-foreground">
        You&apos;ve successfully signed up. Please check your email to
        confirm your account before signing in.
      </p>
    </div>
  );
}
