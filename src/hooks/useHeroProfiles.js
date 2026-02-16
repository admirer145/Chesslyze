import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { getHeroProfileFilterIds, setHeroProfileFilterIds, subscribeHeroProfileFilter } from '../services/heroProfiles';

export const useHeroProfiles = () => {
    const profiles = useLiveQuery(async () => {
        try {
            return await db.heroProfiles.toArray();
        } catch {
            return [];
        }
    }, []);

    const [filterIds, setFilterIdsState] = useState(() => getHeroProfileFilterIds());

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail) {
                setFilterIdsState(e.detail);
            } else {
                setFilterIdsState(getHeroProfileFilterIds());
            }
        };
        return subscribeHeroProfileFilter(handler);
    }, []);

    const setFilterIds = (ids) => {
        setHeroProfileFilterIds(ids);
        setFilterIdsState(ids);
    };

    useEffect(() => {
        if (!profiles || profiles.length === 0) return;
        if (!filterIds.length) return;
        const selected = profiles.filter((p) => filterIds.includes(p.id));
        if (selected.length === 0) {
            setFilterIds([]);
        }
    }, [profiles, filterIds]);

    const activeProfiles = useMemo(() => {
        const all = profiles || [];
        if (!filterIds || filterIds.length === 0) return all;
        const selected = all.filter((p) => filterIds.includes(p.id));
        return selected.length ? selected : all;
    }, [profiles, filterIds]);

    return {
        profiles: profiles || [],
        activeProfiles,
        filterIds,
        setFilterIds
    };
};
