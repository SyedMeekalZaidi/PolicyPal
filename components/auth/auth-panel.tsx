// Auth pages left branding panel with decorative waves
export function AuthPanel() {
  return (
    <div className="hidden lg:flex lg:w-[45%] bg-slate-900 relative overflow-hidden flex-col justify-between p-12">
      {/* Badge */}
      <div className="inline-flex">
        <div className="px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-primary text-sm font-medium">
          AI-powered compliance
        </div>
      </div>

      {/* Content */}
      <div className="z-10">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
          Smart Compliance.
          <br />
          <span className="italic font-bold text-primary">Better Decisions.</span>
        </h1>
        <p className="text-slate-300 text-lg leading-relaxed">
          Streamline regulatory analysis with AI. Summarize policies, compare versions, 
          and audit compliance across multiple documents instantly.
        </p>
      </div>

      {/* Decorative wave shapes - using CSS gradients */}
      <div className="absolute bottom-0 left-0 right-0 h-64 z-0">
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-primary/20 to-transparent rounded-t-[100%]" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-cyan-500/10 to-transparent rounded-t-[120%]" />
        <div className="absolute bottom-0 left-[-10%] w-[60%] h-40 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-[-10%] w-[60%] h-40 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>
    </div>
  );
}
