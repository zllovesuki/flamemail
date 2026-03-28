import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/client/components/app-shell";
import { AdminLogin } from "@/client/components/admin-login";
import { ExternalLinkRedirect } from "@/client/components/external-link-redirect";
import { CreatePage, InboxPage, LandingPage } from "@/client/pages";

export const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/link" element={<ExternalLinkRedirect />} />
      <Route path="/inbox/:address" element={<InboxPage />} />
    </Route>
  </Routes>
);
