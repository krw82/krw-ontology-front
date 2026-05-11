"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) throw authError;
      } else {
        const { error: authError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (authError) throw authError;
      }
      router.push("/companies");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      const map: Record<string, string> = {
        "Invalid login credentials": "이메일 또는 비밀번호가 올바르지 않습니다",
        "User already registered": "이미 가입된 이메일입니다",
        "Email not confirmed": "이메일 인증이 필요합니다",
      };
      setError(map[message] ?? "로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-dark relative overflow-hidden">
      {/* Geometric network background */}
      <div className="absolute inset-0 opacity-20">
        <svg
          className="w-full h-full"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0052ff" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#0052ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Grid lines */}
          {Array.from({ length: 20 }).map((_, i) => (
            <line
              key={`h-${i}`}
              x1="0"
              y1={i * 40}
              x2="1200"
              y2={i * 40}
              stroke="#1a3a6e"
              strokeWidth="0.5"
              strokeOpacity="0.3"
            />
          ))}
          {Array.from({ length: 30 }).map((_, i) => (
            <line
              key={`v-${i}`}
              x1={i * 40}
              y1="0"
              x2={i * 40}
              y2="800"
              stroke="#1a3a6e"
              strokeWidth="0.5"
              strokeOpacity="0.3"
            />
          ))}
          {/* Network nodes */}
          {[
            [200, 150],
            [400, 200],
            [600, 100],
            [800, 250],
            [300, 400],
            [500, 350],
            [700, 450],
            [900, 150],
            [150, 600],
            [450, 550],
            [650, 600],
            [850, 500],
            [1000, 350],
            [350, 300],
          ].map(([cx, cy], i) => (
            <g key={`node-${i}`}>
              <circle cx={cx} cy={cy} r="3" fill="#0052ff" fillOpacity="0.6" />
              <circle cx={cx} cy={cy} r="8" fill="#0052ff" fillOpacity="0.1" />
            </g>
          ))}
          {/* Connecting lines */}
          {[
            [200, 150, 400, 200],
            [400, 200, 600, 100],
            [600, 100, 800, 250],
            [300, 400, 500, 350],
            [500, 350, 700, 450],
            [200, 150, 300, 400],
            [400, 200, 500, 350],
            [600, 100, 700, 450],
            [800, 250, 900, 150],
            [300, 400, 450, 550],
            [500, 350, 650, 600],
            [700, 450, 850, 500],
            [850, 500, 1000, 350],
            [150, 600, 450, 550],
            [650, 600, 850, 500],
            [350, 300, 500, 350],
            [350, 300, 200, 150],
          ].map(([x1, y1, x2, y2], i) => (
            <line
              key={`edge-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#0052ff"
              strokeWidth="0.8"
              strokeOpacity="0.2"
            />
          ))}
          {/* Central glow */}
          <circle cx="600" cy="400" r="300" fill="url(#glow)" />
        </svg>
      </div>

      {/* Top Nav on Dark */}
      <header className="bg-surface-dark w-full sticky top-0 h-[64px] border-b border-white/10 flex-shrink-0 z-50">
        <div className="flex justify-between items-center w-full max-w-[1600px] mx-auto px-md h-full">
          <div className="flex items-center gap-lg">
            <Link
              href="/"
              className="text-[18px] leading-[1.33] font-semibold text-on-dark tracking-tight"
            >
              KRW Ontology
            </Link>
          </div>
          <div className="flex items-center gap-md">
            <Link
              href="/"
              className="text-[14px] leading-[1.4] font-medium text-on-dark-soft hover:text-on-dark transition-colors"
            >
              Documentation
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center relative z-10 px-md">
        <div className="w-full max-w-[440px]">
          {/* Auth Card */}
          <div className="bg-surface-dark-elevated rounded-[24px] p-xl border border-white/10">
            <div className="text-center mb-xl">
              <h1 className="text-[36px] leading-[1.11] tracking-[-0.5px] font-normal text-on-dark mb-sm">
                {mode === "signin" ? "Sign In" : "Create Account"}
              </h1>
              <p className="text-[16px] leading-[1.5] font-normal text-on-dark-soft">
                {mode === "signin"
                  ? "Access institutional-grade ontology research."
                  : "Join KRW Ontology for research and data analysis."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-md">
              <div>
                <label
                  htmlFor="email"
                  className="block text-[14px] leading-[1.4] font-medium text-on-dark-soft mb-xs"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-surface-dark border border-white/10 rounded-[12px] h-[48px] px-base text-[16px] leading-[1.5] font-normal text-on-dark placeholder:text-on-dark-soft focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors"
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-[14px] leading-[1.4] font-medium text-on-dark-soft mb-xs"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-surface-dark border border-white/10 rounded-[12px] h-[48px] px-base text-[16px] leading-[1.5] font-normal text-on-dark placeholder:text-on-dark-soft focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors"
                  placeholder="Enter your password"
                  minLength={6}
                  maxLength={128}
                />
              </div>

              {error && (
                <div className="text-[14px] leading-[1.5] font-normal text-semantic-down bg-semantic-down/10 border border-semantic-down/20 rounded-[12px] p-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-container text-on-primary text-[16px] leading-[1.15] font-semibold h-[44px] rounded-full hover:bg-primary-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? "Loading..."
                  : mode === "signin"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </form>

            <div className="mt-lg text-center">
              <button
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                }}
                className="text-[16px] leading-[1.15] font-semibold text-primary hover:text-primary-fixed transition-colors"
                type="button"
              >
                {mode === "signin"
                  ? "Don't have an account? Sign Up"
                  : "Already have an account? Sign In"}
              </button>
            </div>
          </div>

          {/* Subtitle */}
          <p className="text-center mt-lg text-[14px] leading-[1.5] font-normal text-on-dark-soft">
            Institutional-grade research powered by KRW Ontology.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-lg text-center border-t border-white/5">
        <p className="text-[14px] leading-[1.5] font-normal text-on-dark-soft">
          &copy; 2026 KRW Ontology. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
