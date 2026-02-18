# Course Project - Information

This project will provide you with hands-on experience in designing, implementing, and deploying interactive visualizations. Your project should address a concrete visualization challenge based on a given dataset, and propose a creative solution based on principles discussed in the course.

This page provides information and context about the final project for this course:

- Project details, including requirements, data, and delivery schedule
- Inspirations and resources
- Grading criteria

If you are unsure about anything, please have a chat with the instructor to help clarify any concerns well in advance of the deadline.

## Project Details

### Organization

For this project, you will be required to work in teams of two. If there are an uneven number of students in the course, a group of three will be permitted. If you do not find a partner, the instructor will pair you up with someone with similar interests.

We recognize that some of you are not a fan of group work, but this is a reality in almost any profession you work in after university, and it is equally important to develop these skills as it is to develop your programming skills.

### Project Requirements

You will build a 2D (or 3D) linked, multi-view interactive visual web application that employs algorithms and design to allow an end-user to explore and better understand a given dataset. Your project should draw from visualization theory and methods covered in the course. You can set up your application as an interactive dashboard, or as an interactive story, provided that you meet all of the following requirements.

Your visual application must:

- include a minimum of two linked, interactive views that show different aspects and perspectives of the data. The number of views should correspond to the time and design effort put into making the views (for example, minimum of two views if they are bespoke, or minimum of four views if they are out-of-the-box e.g., with Plot). Depending on how you organize your visualization, it may not make sense for all views to be cross-linked with each other, but we do expect that all views in your visualization are somehow linked.
- include one or more views revealing the temporal and spatial dimensions of the data
- combine design + interaction techniques to allow the user to explore the data themselves, e.g., highlight, filter, select, adjust parameter(s), etc.
- include sufficient guidance instructions that support an end-user with understanding and using the application
- Create and deploy your visualization on the web. We prefer you use libraries and services that have been discussed/demoed in the course labs (e.g., [D3](https://d3js.org/), [Plot](https://observablehq.com/plot/)). [Observable Framework](https://observablehq.com/framework/) is a nice option for managing and deploying your data visualization application using the simplicity of Markdown combined with JavaScript.
  - If you would like to work in something else (e.g., another language), or a different framework or data management pipeline (e.g., Flask, Django etc.), you must discuss this with the instructor in advance of project implementation (March 10) and understand that you will receive limited support should you run into problems.
- Your code must compile and run within a reasonable time on a 2023 M3 Macbook Pro (instructor's computer). Ensure your application does not have long wait times or is sluggish – remember, no users are patient! You can consider preprocessing during startup if you have complex calculations you need to run.

The features and finish of the final product should be commensurate with the time allotted in the course for you to work on this as well as your team size. To give you a sense for a team of two people, this should come out to ~120 hours of combined time put into all parts of the project.

For use of genAI/LLMs in any part of this project, please refer to the course syllabus for the general course policy on use of AI. Please feel free to ask if you have any questions or concerns.

## Data

You may choose from two possible data scenarios below to develop your visual application:

- Climate-Conflict-Vulnerability
- City Bikes

If you have an alternative dataset in mind, you must discuss and agree this with the course instructor in advance of the course project kick-off session (February 17).

## Project Milestones

Throughout the semester you will have five key milestones that help keep you on track and work as check-ins for you with your classmates and myself. These include:

- **Visualization Design Sheets 1-4:** Brainstorming sketches [February 23]
- **Visualization Design Sheet 5:** Finalized sketch(es) [March 2]
- **Midpoint check-in session** [March 26]
- **Project Final Deliverables** [May 4]
  - In the final week, you will submit a link to your deployed application (GitHub Pages) and a ZIP file containing all the code and documentation for generating this application. See assignment page for detailed rubric.
- **Project Presentation** [May 5]
  - In the final week, you will have 15 minutes to showcase your final project. In your presentation, you should justify your design and algorithm decisions, and explain the parts of your code that are driving the individual design views and interactions. See assignment page for detailed rubric.

## Resources and Inspiration

Below are some visuals that you may find inspiring as you begin brainstorming and working on your course project. Don't be afraid to try something new and experiment with different ideas, using the theory and principles that we have discussed in class as a springboard for your work here.

NB: There is a strong COVID theme in these examples, which is not really the intent—it's just that COVID generated many, many data visualizations that pushed the envelope of what was possible and accepted in the field.

### Visual Analytics Dashboard

- Loon: Using Exemplars to Visualize Large-Scale Microscopy Data, Lange et al. 2021, Sci Institute, University of Utah
- MIT Visualization Group COVID-19 Data Visualizations Dashboard, Lee et al. 2021 from MIT Visualization Group
- RadEx: Integrated Visual Exploration of Multiparameteric Studies for Radiomic Tumor Profiling, Morth et al., 2020, UiB
- DimLift: Interactive Hierarchical Data Exploration through Dimensional Bundling, Garrison et al. 2021, UiB
- IBM Watson News Explorer, IBM
- Weather Monitoring Dashboard, from ArcGIS
- Climate Cartographics

### Data-Driven Visual Story

- Visualization of the Boston subway system, Barry & Card
- My life with Long COVID, Georgia Lupi for NYTimes Opinion, Dec 2023
- 24 hours in an invisible epidemic, The Pudding
- The data visualizations behind COVID-19 skepticism, Lee et al. 2021 from MIT Visualization Group
- Harry Stevens' simulitis visualizations

### Other (Possibly Helpful) Resources

NB: Most of these recommendations are to facilitate web-based application development.

- Vega-Lite (JSON) / Vega-Altair (Python) – high-level interactive grammars
- ThreeJS – 3D JS library
- D3-tip – library for tooltips with D3
- Observable Framework – Deploy visualizations via Markdown + JS

## Project Grading Criteria

This project will be worth 30% of your final course grade. Please see below for the criteria that we will use to grade the project.

### P01 FDS Sheets 1-4

Initial brainstorming (Sheet 1) and refined three design options (Sheets 2, 3, 4) from the Five Design Sheets (FDS) Method. See assignment page for details.

**Rubric: 2.5 pt possible**

- (0.5pt) Sheet 1 includes several (at least 5 different sketch ideas), with clear reflection and filtering/consolidation
- (0.5pt) Sheets 2, 3, and 4 are included
- (0.5pt per sheet) For Sheets 2, 3, and 4, each have:
  - a layout sketch
  - smaller focus/detail sketches
  - description or list of possible interactions
  - discussion points (novelty, limitations of approach)

### P02 FDS Sheet 5

Final refined design plan from the Five Design Sheets Method (Sheet 5). See assignment page for details.

**Rubric: 2.5 pt possible**

- (0.5pt) sheet shows refinements/improvements over previous sheet set
- (0.5pt) layout sketch shows overview of possible interface
- (0.5pt) smaller focus/detail sketches show key features in more detail
- (0.5pt) description or list of possible algorithms, dependencies, interactions illustrate how interactivity could work in the tool
- (0.5pt) discussion points (novelty, limitations of approach, time estimates, specific hardware requirements) are included

### P03 Project Final Deliverables

See assignment page for details.

**Rubric: 15 points possible**

- (3pt) Data analysis methods (e.g., data processing and cleaning, transformations, handling of missing values, etc.)
  - 0 = Analysis methods applied to data are inappropriate or not considered at all
  - 1 = Significant problems with correctness of analysis methods with data
  - 2 = Some problems with correctness
  - 3 = Analysis methods well-considered and appropriate
- (3pt) Visual design (aesthetics, accessibility considerations, etc.)
  - 0 = Nonsensical
  - 1 = Major problems
  - 2 = Some problems
  - 3 = Well-considered and aesthetic data encodings, chart design, overall layout
- (3pt) Interactions
  - 0 = No interactivity
  - 1 = Major problems
  - 2 = Some problems
  - 3 = Well-considered and appropriate
- (2pt) Creativity (Note: Taking and applying an idea from a different domain and applying in a new context counts for creativity here!)
  - 0 = No creative efforts made. All design and interaction choices are essentially replicated from others in the same domain
  - 1 = Visualization/project includes some creative/novel ideas, but many elements are standard/replicated/derivative
  - 2 = Highly creative and novel visualizations/overall application
- (2pt) Audience fit/task alignment
  - 0 = Visualization/overall application does not align at all with project brief
  - 1 = Many questionable choices made in analysis, visual and interaction design, etc., that do not align with audience profile and goals
  - 2 = Well-considered analysis and design that aligns with audience profile and tasks
- (2pt) Organization of project (i.e., can someone else, or you in a year, understand what is going on in this project and run it?)
  - 0 = Little/no documentation, code and project structure is poorly organized and extremely difficult to follow, requires effort to launch application
  - 1 = Some documentation, code and project structure difficult to follow in some parts.
  - 2 = Code is clean and well structured, good documentation, uses Makefile appropriately (if present), minimal effort to run application.

### P04 Project Presentation

15 minute oral presentation and demonstration of project with thorough discussion of inspiration and rationale. See assignment page for details.

**Rubric: 10 pt possible**

- (2pt) A short introduction to the project, including background and motivation for why a visualization is necessary for these data
  - 0 = None considered
  - 1 = Some introduction to the problem domain, but it is unclear who the audience is and/or why visualization is specifically needed for the data
  - 2 = A well-considered introduction to the problem domain, audience, and motivation for visualization of data
- (3pt) A discussion of rationale for key design/development choices made in the application (focus on a few key features, since time is short)
  - 0.5 pts are given for discussing each of the following:
    - data and data abstraction
    - end-user tasks and task abstraction
    - visual encodings/idioms employed
    - interaction idioms employed
    - show the works that inspired you
    - show the progression of your concept sketches from the 5 design sheets method (all 5 sheets)
- (2pt) A demonstration (live or video) of the working application to show the key features implemented
  - 0 = No demo of the application
  - 1 = A live or video demo is shown but it does not aid the presenter in showing the key features (e.g., demo video goes by too fast, too zoomed out to see features)
  - 2 = A live or video demo clearly showcases the key features implemented
- (3pt) Self-evaluation / reflection through metrics or heuristics on the success of the visualization application:
  - 0 = None considered
  - 1 = Some thought given, but misalignment of metric to actual evaluation goal
  - 2 = Considered but no adjustments made to the visualization
  - 3 = Considered, and resulted in adjustments to the visualization
