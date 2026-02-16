import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import './App.css';
import { ensureLegacyHeroProfile } from './services/heroProfiles';

import { Dashboard } from './components/Dashboard/Dashboard';
import { ImportGames } from './components/Import/ImportGames';
import { GamesLibrary } from './components/Library/GamesLibrary';
// Removed placeholder Dashboard


import { ReelFeed } from './components/Reel/ReelFeed';
import { OpeningExplorer } from './components/Opening/OpeningExplorer';
import { Profile } from './components/Profile/Profile';
import { Settings } from './components/Settings/Settings';
// Removed Openings placeholder


function App() {
  // Use /Chesslyze/ basename in production, / in development
  const basename = import.meta.env.PROD ? '/Chesslyze' : '/';

  useEffect(() => {
    ensureLegacyHeroProfile();
  }, []);

  return (
    <Router basename={basename}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<ImportGames />} />
          <Route path="/library" element={<GamesLibrary />} />
          <Route path="/reels" element={<ReelFeed />} />
          <Route path="/openings" element={<OpeningExplorer />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
