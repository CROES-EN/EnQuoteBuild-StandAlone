import {ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight, FilePlus2, FileText, FolderPlus, MoreHorizontal, Palette, Pencil, Plus, Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";
import {flattenPages, SECTION_COLORS} from "./sopSections";

export default function SopNotebookNav({
  sections,
  pages,
  selectedSectionId,
  selectedPageId,
  search,
  searchResults,
  sectionNames,
  collapsed,
  onCollapsedChange,
  onSearchChange,
  onSelectSection,
  onSelectPage,
  onCreateSection,
  onRenameSection,
  onRecolorSection,
  onMoveSection,
  onDeleteSection,
  onCreatePage,
  onCreateSubPage,
  onMovePage,
  onMovePageToSection,
  onDeletePage
}) {
  const selectedPage = pages.find((page) => page.id === selectedPageId);
  const visiblePages = flattenPages(pages, selectedSectionId);
  const hasSearch = search.trim().length > 0;
  const pageList = hasSearch ? searchResults : visiblePages;

  if (collapsed) {
    return (
      <div className="flex min-h-[64vh] flex-col items-center gap-2 overflow-hidden rounded-lg border bg-card p-2 shadow-sm">
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Expand SOP navigation" onClick={() => onCollapsedChange(false)}>
          <ChevronsRight className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Add section" onClick={onCreateSection}>
          <FolderPlus className="h-4 w-4" />
        </Button>
        <div className="mt-1 flex flex-1 flex-col items-center gap-2 overflow-y-auto">
          {sections.map((section) => {
            const selected = section.id === selectedSectionId;
            return (
              <button
                key={section.id}
                type="button"
                title={section.title}
                aria-label={section.title}
                onClick={() => onSelectSection(section.id)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:bg-muted",
                  selected ? "border-primary bg-primary/10" : "border-border bg-background"
                )}
              >
                <span className="h-3.5 w-3.5 rounded-full" style={{backgroundColor: section.color || SECTION_COLORS[0]}} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[64vh] overflow-hidden rounded-lg border bg-card shadow-sm md:grid-cols-[9.5rem_minmax(13rem,1fr)]">
      <aside className="border-r bg-muted/30 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-1.5">
          <h2 className="text-sm font-semibold text-foreground">Sections</h2>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Add section" onClick={onCreateSection}>
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Collapse SOP navigation" onClick={() => onCollapsedChange(true)}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          {sections.map((section) => {
            const selected = section.id === selectedSectionId;
            return (
              <div
                key={section.id}
                className={cn(
                  "group flex items-center rounded-r-md border-l-4 transition-colors",
                  selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                )}
                style={{borderLeftColor: section.color || SECTION_COLORS[0]}}
              >
                <button
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm font-medium"
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{backgroundColor: section.color || SECTION_COLORS[0]}} />
                  <span className="truncate">{section.title}</span>
                </button>
                <SectionMenu
                  section={section}
                  onRenameSection={onRenameSection}
                  onRecolorSection={onRecolorSection}
                  onMoveSection={onMoveSection}
                  onDeleteSection={onDeleteSection}
                />
              </div>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="space-y-2 border-b p-2.5">
          <Input className="h-8" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search all SOP pages" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8 w-full justify-between">
                <span className="flex items-center"><Plus className="mr-1 h-4 w-4" /> Page</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => onCreatePage(selectedSectionId)}>
                <Plus className="mr-2 h-4 w-4" /> New page
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!selectedPage || selectedPage.parent_id} onClick={() => onCreateSubPage(selectedPage)}>
                <FilePlus2 className="mr-2 h-4 w-4" /> New sub-page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {pageList.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted-foreground">{hasSearch ? "No SOP pages match your search." : "No pages in this section yet."}</li>
          ) : pageList.map((page) => (
            <li key={page.id}>
              <div
                className={cn(
                  "group flex items-stretch rounded-md border transition-colors",
                  page.id === selectedPageId ? "border-primary/40 bg-primary/10 text-foreground" : "border-transparent hover:bg-muted"
                )}
              >
                <button type="button" onClick={() => onSelectPage(page.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{paddingLeft: `${(page.depth || 0) * 1.1}rem`}}>
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{page.title}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
                    {hasSearch ? sectionNames[page.section_id] || "General" : page.summary || page.category || "No summary"}
                  </div>
                </button>
                <PageMenu
                  page={page}
                  sections={sections}
                  selectedPage={selectedPage}
                  onCreateSubPage={onCreateSubPage}
                  onMovePage={onMovePage}
                  onMovePageToSection={onMovePageToSection}
                  onDeletePage={onDeletePage}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SectionMenu({section, onRenameSection, onRecolorSection, onMoveSection, onDeleteSection}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="mr-1 h-7 w-7 flex-shrink-0 opacity-70 hover:opacity-100" aria-label={`Section actions for ${section.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onRenameSection(section.id)}><Pencil className="mr-2 h-4 w-4" /> Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRecolorSection(section.id)}><Palette className="mr-2 h-4 w-4" /> Colour</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onMoveSection(section.id, -1)}><ChevronUp className="mr-2 h-4 w-4" /> Move up</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMoveSection(section.id, 1)}><ChevronDown className="mr-2 h-4 w-4" /> Move down</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteSection(section.id)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PageMenu({page, sections, selectedPage, onCreateSubPage, onMovePage, onMovePageToSection, onDeletePage}) {
  const isSubPage = Boolean(page.parent_id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="m-1 h-7 w-7 flex-shrink-0 opacity-70 hover:opacity-100" aria-label={`Page actions for ${page.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isSubPage} onClick={() => onCreateSubPage(page)}><FilePlus2 className="mr-2 h-4 w-4" /> Add sub-page</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onMovePage(page.id, -1)}><ChevronUp className="mr-2 h-4 w-4" /> Move up</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMovePage(page.id, 1)}><ChevronDown className="mr-2 h-4 w-4" /> Move down</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {sections.map((section) => (
              <DropdownMenuItem key={section.id} disabled={section.id === page.section_id} onClick={() => onMovePageToSection(page, section.id)}>
                <span className="h-2.5 w-2.5 rounded-full" style={{backgroundColor: section.color || SECTION_COLORS[0]}} />
                {section.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDeletePage?.(page.id === selectedPage?.id ? selectedPage : page)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete page
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
