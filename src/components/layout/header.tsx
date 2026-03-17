import { SidebarTrigger } from "@/components/ui/sidebar"
import Image from "next/image"

export default function Header() {

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/80 backdrop-blur-sm px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-0 mb-4">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <SidebarTrigger />
        </div>
        
        <div className="flex items-center gap-2">
          <Image 
            src="/StreamWeaver.png" 
            alt="StreamWeaver" 
            width={32} 
            height={32}
            className="rounded-md"
          />
          <span className="font-bold text-lg hidden sm:inline bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            StreamWeaver
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        {/* Space Mountain badges removed */}
      </div>
    </header>
  )
}
