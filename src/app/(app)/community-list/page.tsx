import { CommunityList } from '@/components/community-list';

export default function CommunityListPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Community List</h1>
      </div>

      <CommunityList />
    </div>
  );
}
